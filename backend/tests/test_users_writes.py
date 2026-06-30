import pytest

from app.repo import users as repo


@pytest.mark.asyncio
async def test_create_and_delete_user(seed):
    created = await repo.create_user("Test User", "testuser", "password123", "inspector", "ags")
    assert created.username == "testuser"
    assert created.role == "inspector"

    listed = await repo.list_users()
    assert any(u.id == created.id for u in listed)

    await repo.delete_user(created.id)
    assert not any(u.id == created.id for u in await repo.list_users())


@pytest.mark.asyncio
async def test_cannot_delete_last_admin(seed):
    admins = [u for u in await repo.list_users() if u.role == "admin"]
    assert len(admins) == 1
    with pytest.raises(Exception, match="last admin"):
        await repo.delete_user(admins[0].id)


@pytest.mark.asyncio
async def test_short_password_rejected(seed):
    with pytest.raises(Exception, match="at least 8"):
        await repo.create_user("Short", "shortpw", "abc", "inspector", "ags")


@pytest.mark.asyncio
async def test_duplicate_username_rejected(seed):
    with pytest.raises(Exception, match="Username already taken"):
        await repo.create_user("Dup", "admin", "password123", "inspector", "ags")
