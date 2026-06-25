from datetime import datetime, timezone
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import ProjectRepoMapping
from app.db.session import get_db
from app.middleware.auth_guard import require_auth
from app.schemas.mappings import MappingCreate, MappingListResponse, MappingResponse, MappingUpdate

router = APIRouter(prefix="/api/mappings", tags=["mappings"])


@router.get("", response_model=MappingListResponse)
async def list_mappings(
    _: dict = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ProjectRepoMapping).order_by(ProjectRepoMapping.jira_project_key)
    )
    mappings = result.scalars().all()
    return MappingListResponse(mappings=mappings)


@router.post("", response_model=MappingResponse, status_code=201)
async def create_mapping(
    body: MappingCreate,
    _: dict = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    mapping = ProjectRepoMapping(
        jira_project_key=body.jira_project_key,
        bitbucket_workspace=body.bitbucket_workspace.strip(),
        bitbucket_repo_slug=body.bitbucket_repo_slug.strip(),
        master_branch=body.master_branch.strip(),
        beta_branch=body.beta_branch.strip(),
        beta_website_url=body.beta_website_url.strip(),
        master_website_url=body.master_website_url.strip(),
    )
    db.add(mapping)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=409,
            detail=f"A mapping for project {body.jira_project_key} already exists",
        )
    await db.refresh(mapping)
    return mapping


@router.put("/{mapping_id}", response_model=MappingResponse)
async def update_mapping(
    mapping_id: uuid.UUID,
    body: MappingUpdate,
    _: dict = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    mapping = await db.get(ProjectRepoMapping, mapping_id)
    if not mapping:
        raise HTTPException(status_code=404, detail="Mapping not found")

    updates = body.model_dump(exclude_unset=True)
    for field, value in updates.items():
        if isinstance(value, str):
            value = value.strip()
        setattr(mapping, field, value)
    mapping.updated_at = datetime.now(timezone.utc)

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="A mapping with that project key already exists")
    await db.refresh(mapping)
    return mapping


@router.delete("/{mapping_id}", status_code=204)
async def delete_mapping(
    mapping_id: uuid.UUID,
    _: dict = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    mapping = await db.get(ProjectRepoMapping, mapping_id)
    if not mapping:
        raise HTTPException(status_code=404, detail="Mapping not found")
    await db.delete(mapping)
    await db.commit()
