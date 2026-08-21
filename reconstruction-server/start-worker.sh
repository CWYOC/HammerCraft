#!/bin/bash

# =========================================================
# HAMMER CRAFT
# LOCAL EAR RECONSTRUCTION PROCESSOR
# =========================================================


# ---------------------------------------------------------
# PROJECT LOCATION
#
# Change this ONLY if you move reconstruction-server.
# ---------------------------------------------------------

PROJECT_DIR="/Users/bearcheung/Documents/Item_website/HammerCraft/reconstruction-server"


# ---------------------------------------------------------
# GO TO PROJECT
# ---------------------------------------------------------

cd "$PROJECT_DIR" || {

    echo ""
    echo "=============================================="
    echo "HAMMER CRAFT PROCESSOR"
    echo "=============================================="
    echo ""
    echo "ERROR:"
    echo "Reconstruction server folder was not found."
    echo ""
    echo "$PROJECT_DIR"
    echo ""
    read -n 1 -s -r -p "Press any key to close..."
    exit 1

}


# ---------------------------------------------------------
# CHECK VIRTUAL ENVIRONMENT
# ---------------------------------------------------------

if [ ! -f ".venv/bin/activate" ]; then

    echo ""
    echo "=============================================="
    echo "HAMMER CRAFT PROCESSOR"
    echo "=============================================="
    echo ""
    echo "ERROR:"
    echo "Python virtual environment was not found."
    echo ""
    echo "Expected:"
    echo "$PROJECT_DIR/.venv"
    echo ""
    read -n 1 -s -r -p "Press any key to close..."
    exit 1

fi


# ---------------------------------------------------------
# ACTIVATE PYTHON ENVIRONMENT
# ---------------------------------------------------------

source ".venv/bin/activate"


# ---------------------------------------------------------
# APPLE SILICON / PYTORCH
# ---------------------------------------------------------

export PYTORCH_ENABLE_MPS_FALLBACK=1


# ---------------------------------------------------------
# PATH
#
# Makes Homebrew programs such as COLMAP available when
# this script is started by macOS rather than VS Code.
# ---------------------------------------------------------

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"


# ---------------------------------------------------------
# HEADER
# ---------------------------------------------------------

clear

echo "=============================================="
echo " HAMMER CRAFT"
echo " LOCAL EAR RECONSTRUCTION PROCESSOR"
echo "=============================================="
echo ""

echo "Project:"
echo "$PROJECT_DIR"
echo ""

echo "Python:"
python --version

echo ""

echo "COLMAP:"
colmap version 2>/dev/null || echo "COLMAP not found"

echo ""

echo "----------------------------------------------"
echo "Checking accelerator..."
echo "----------------------------------------------"

python - <<'PY'

import torch

print("PyTorch:", torch.__version__)

if torch.cuda.is_available():

    print("Accelerator: CUDA")
    print("GPU:", torch.cuda.get_device_name(0))

elif (
    hasattr(torch.backends, "mps")
    and
    torch.backends.mps.is_available()
):

    print("Accelerator: MPS / Apple Metal")

else:

    print("Accelerator: CPU")

PY


echo ""
echo "=============================================="
echo " STARTING WORKER"
echo "=============================================="
echo ""


# ---------------------------------------------------------
# START WORKER
# ---------------------------------------------------------

python worker.py


# ---------------------------------------------------------
# IF WORKER STOPS
# ---------------------------------------------------------

EXIT_CODE=$?

echo ""
echo "=============================================="
echo " PROCESSOR STOPPED"
echo "=============================================="
echo ""

echo "Exit code:"
echo "$EXIT_CODE"

echo ""

read -n 1 -s -r -p "Press any key to close..."