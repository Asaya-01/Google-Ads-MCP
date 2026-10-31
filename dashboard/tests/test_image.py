import re

from app import settings


def test_the_docker_image_copies_every_top_level_data_file():
    """The job that stopped on its first run did so because the image did not
    contain retention_catalog.json. Anything the app reads from the project
    root must be copied into the image."""
    dockerfile = (settings.ROOT / "Dockerfile").read_text(encoding="utf-8")
    copied = set(re.findall(r"^COPY\s+(\S+)\s", dockerfile, re.M))
    for path in settings.ROOT.glob("*.json"):
        assert path.name in copied, f"{path.name} is not copied into the image"
    for folder in ("app", "sql", "static"):
        assert folder in copied
