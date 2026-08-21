#!/bin/bash

set -e


PROJECT_DIR="/Users/bearcheung/Documents/Item_website/HammerCraft/reconstruction-server"


cd "$PROJECT_DIR"


source ".venv/bin/activate"


rm -rf build
rm -rf dist

rm -f "Hammer Craft Processor.spec"


python -m pip install -U pyinstaller


pyinstaller \
    --noconfirm \
    --clean \
    --windowed \
    --name "Hammer Craft Processor" \
    --add-data ".env:." \
    --collect-all supabase \
    --collect-all torch \
    --collect-all trimesh \
    --collect-all pymeshfix \
    --collect-all pyvista \
    --hidden-import worker \
    --hidden-import reconstruct \
    --hidden-import mesh_cleanup \
    --hidden-import tkinter \
    --hidden-import tkinter.ttk \
    --hidden-import tkinter.messagebox \
    processor_app.py


echo ""
echo "=============================================="
echo " HAMMER CRAFT PROCESSOR BUILT"
echo "=============================================="
echo ""

echo "Application:"
echo "$PROJECT_DIR/dist/Hammer Craft Processor.app"
echo ""