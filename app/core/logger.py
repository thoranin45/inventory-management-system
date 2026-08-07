import logging
import os
from logging.handlers import RotatingFileHandler


LOG_DIR = "logs"
LOG_FILE = os.path.join(
    LOG_DIR,
    "app.log",
)

os.makedirs(
    LOG_DIR,
    exist_ok=True,
)


logger = logging.getLogger(
    "inventory_system"
)

logger.setLevel(
    logging.INFO
)

logger.propagate = False


formatter = logging.Formatter(
    "%(asctime)s | %(levelname)s | %(message)s"
)


if not logger.handlers:
    console_handler = logging.StreamHandler()

    console_handler.setFormatter(
        formatter
    )

    file_handler = RotatingFileHandler(
        LOG_FILE,
        maxBytes=10 * 1024 * 1024,
        backupCount=5,
        encoding="utf-8",
    )

    file_handler.setFormatter(
        formatter
    )

    logger.addHandler(
        console_handler
    )

    logger.addHandler(
        file_handler
    )