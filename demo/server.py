"""A tiny async status server for the DRA controller."""
import asyncio
from dataclasses import dataclass


@dataclass
class Claim:
    name: str
    driver: str
    ready: bool = False


class Server:
    def __init__(self) -> None:
        self.claims: list[Claim] = []

    async def add(self, claim: Claim) -> None:
        await asyncio.sleep(0)
        self.claims.append(claim)

    def pending(self) -> list[Claim]:
        return [c for c in self.claims if not c.ready]
