from datetime import datetime, timezone
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.crypto import encrypt_token
from app.db.models import ProjectRepoMapping
from app.db.session import get_db
from app.middleware.auth_guard import require_auth
from app.schemas.mappings import MappingCreate, MappingListResponse, MappingResponse, MappingUpdate
from app.services.deploy_commands import build_post_merge_shell_script

router = APIRouter(prefix="/api/mappings", tags=["mappings"])

_SECRET_FIELDS = ("ssh_password", "ssh_private_key")
_MODEL_FIELDS = {
    "beta_post_pr_merge_commands": "beta_post_pr_merge_command",
    "master_post_pr_merge_commands": "master_post_pr_merge_command",
}


def mapping_to_response(mapping: ProjectRepoMapping) -> MappingResponse:
    return MappingResponse(
        id=mapping.id,
        jira_project_key=mapping.jira_project_key,
        bitbucket_workspace=mapping.bitbucket_workspace,
        bitbucket_repo_slug=mapping.bitbucket_repo_slug,
        master_branch=mapping.master_branch,
        beta_branch=mapping.beta_branch,
        beta_website_url=mapping.beta_website_url,
        master_website_url=mapping.master_website_url,
        rules=mapping.rules,
        skills=mapping.skills,
        ssh_host=mapping.ssh_host,
        ssh_port=mapping.ssh_port,
        ssh_username=mapping.ssh_username,
        ssh_password_configured=bool(mapping.ssh_password_encrypted),
        ssh_private_key_configured=bool(mapping.ssh_private_key_encrypted),
        ssh_auth_type=mapping.ssh_auth_type or "password",
        ssh_use_sudo=bool(mapping.ssh_use_sudo),
        project_root_directory=mapping.project_root_directory,
        beta_post_pr_merge_commands=mapping.beta_post_pr_merge_command,
        master_post_pr_merge_commands=mapping.master_post_pr_merge_command,
        beta_post_merge_shell_preview=build_post_merge_shell_script(
            mapping.project_root_directory,
            mapping.beta_post_pr_merge_command,
            use_sudo=bool(mapping.ssh_use_sudo),
        ),
        master_post_merge_shell_preview=build_post_merge_shell_script(
            mapping.project_root_directory,
            mapping.master_post_pr_merge_command,
            use_sudo=bool(mapping.ssh_use_sudo),
        ),
        created_at=mapping.created_at,
        updated_at=mapping.updated_at,
    )


def _apply_secret_fields(mapping: ProjectRepoMapping, data: dict) -> None:
    ssh_password = data.pop("ssh_password", None)
    if ssh_password is not None and ssh_password.strip():
        mapping.ssh_password_encrypted = encrypt_token(ssh_password.strip())

    ssh_private_key = data.pop("ssh_private_key", None)
    if ssh_private_key is not None and ssh_private_key.strip():
        mapping.ssh_private_key_encrypted = encrypt_token(ssh_private_key.strip())


def _apply_mapping_fields(mapping: ProjectRepoMapping, data: dict) -> None:
    _apply_secret_fields(mapping, data)

    for field, value in data.items():
        if field in _SECRET_FIELDS:
            continue
        model_field = _MODEL_FIELDS.get(field, field)
        if isinstance(value, str):
            value = value.strip()
        setattr(mapping, model_field, value)


@router.get("", response_model=MappingListResponse)
async def list_mappings(
    _: dict = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ProjectRepoMapping).order_by(ProjectRepoMapping.jira_project_key)
    )
    mappings = result.scalars().all()
    return MappingListResponse(mappings=[mapping_to_response(m) for m in mappings])


@router.post("", response_model=MappingResponse, status_code=201)
async def create_mapping(
    body: MappingCreate,
    _: dict = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    mapping = ProjectRepoMapping()
    _apply_mapping_fields(mapping, body.model_dump())

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
    return mapping_to_response(mapping)


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
    _apply_secret_fields(mapping, updates)

    for field, value in updates.items():
        if field in _SECRET_FIELDS:
            continue
        model_field = _MODEL_FIELDS.get(field, field)
        if isinstance(value, str):
            value = value.strip()
        setattr(mapping, model_field, value)
    mapping.updated_at = datetime.now(timezone.utc)

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="A mapping with that project key already exists")
    await db.refresh(mapping)
    return mapping_to_response(mapping)


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
