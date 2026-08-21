#!/bin/bash

PROJECT_DIR="/Users/bearcheung/Documents/Item_website/HammerCraft/reconstruction-server"

cd "$PROJECT_DIR" || exit 1


source ".venv/bin/activate"


export PYTORCH_ENABLE_MPS_FALLBACK=1

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"


python processor_app.py