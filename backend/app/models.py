from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class _Camel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class Drone(_Camel):
    id: str
    airport_id: str
    model: str
    status: str
    battery: int | None = None
    assignment: str | None = None
    last_seen: str | None = None
    created_at: str
