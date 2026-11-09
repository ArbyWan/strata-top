"""strata-top — registration: schemas wired to handlers, slash command, bundled skill."""
import logging
from pathlib import Path

from . import schemas, tools

logger = logging.getLogger(__name__)


def register(ctx):
    ctx.register_tool(
        name="strata_top_status",
        toolset="strata-top",
        schema=schemas.STRATA_TOP_STATUS,
        handler=tools.strata_top_status,
    )
    # Slash handlers read settings through the same resolver the Desktop form saves through.
    tools.init(lambda key, default=None: ctx.get_config(key, default=default))

    ctx.register_command(
        "strata-top",
        handler=tools.slash_frame,
        description="Print one live frame from the Strata server's /status.",
        args_hint="[help]",
    )

    skills_dir = Path(__file__).parent / "skills"
    for child in sorted(skills_dir.iterdir()):
        skill_md = child / "SKILL.md"
        if child.is_dir() and skill_md.exists():
            ctx.register_skill(child.name, skill_md)

    logger.debug("strata-top registered (endpoint=%s)", ctx.get_config("endpoint", default="http://127.0.0.1:8080"))
