"""A tiny async status server for the DRA controller."""
import asyncio
from dataclasses import dataclass, field


@dataclass
class Claim:
    name: str
    driver: str
    ready: bool = False
    devices: list[str] = field(default_factory=list)


class Server:
    def __init__(self) -> None:
        self.claims: list[Claim] = []

    async def add(self, claim: Claim) -> None:
        await asyncio.sleep(0)
        self.claims.append(claim)

    async def ready(self, name: str) -> None:
        for c in self.claims:
            if c.name == name:
                c.ready = True

    def pending(self) -> list[Claim]:
        return [c for c in self.claims if not c.ready]
