import os
import sys
import logging

from logging.handlers import RotatingFileHandler

os.makedirs("logs", exist_ok=True)

LOG_FILE = "logs/app.log"

logger = logging.getLogger("inventory_system")
logger.setLevel(logging.INFO)

if logger.hasHandlers():
    logger.handlers.clear()

formatter = logging.Formatter(
    "%(asctime)s | %(levelname)s | %(message)s"
)

# ==========================
# File Handler
# ==========================

file_handler = RotatingFileHandler(
    LOG_FILE,
    maxBytes=5 * 1024 * 1024,
    backupCount=5,
    encoding="utf-8",
)

file_handler.setFormatter(formatter)

# ==========================
# Console Handler
# ==========================

console_handler = logging.StreamHandler(sys.stdout)
console_handler.setFormatter(formatter)

# ==========================
# Register
# ==========================

logger.addHandler(file_handler)
logger.addHandler(console_handler)

logger.propagate = False