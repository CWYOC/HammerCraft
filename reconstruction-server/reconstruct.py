from pathlib import Path
import shutil
import subprocess


def run(command):
    command = [str(item) for item in command]

    print("\n=================================================")
    print("RUNNING:")
    print(" ".join(command))
    print("=================================================\n")

    subprocess.run(
        command,
        check=True
    )


def reconstruct(
    image_dir: Path,
    workspace: Path
) -> Path:

    """
    Reconstruct one ear from an ordered set
    of overlapping images.

    Returns:
        Path to raw PLY mesh.
    """

    image_dir = Path(image_dir)
    workspace = Path(workspace)

    if not image_dir.exists():
        raise RuntimeError(
            f"Image folder not found: {image_dir}"
        )

    image_count = len(
        list(image_dir.glob("*.jpg"))
        +
        list(image_dir.glob("*.jpeg"))
        +
        list(image_dir.glob("*.JPG"))
        +
        list(image_dir.glob("*.JPEG"))
    )

    if image_count < 10:
        raise RuntimeError(
            f"Not enough images for reconstruction: {image_count}"
        )

    if workspace.exists():
        shutil.rmtree(workspace)

    workspace.mkdir(
        parents=True,
        exist_ok=True
    )

    database_path = (
        workspace /
        "database.db"
    )

    sparse_dir = (
        workspace /
        "sparse"
    )

    dense_dir = (
        workspace /
        "dense"
    )

    sparse_dir.mkdir(
        parents=True,
        exist_ok=True
    )

    # =====================================================
    # 1. FEATURE EXTRACTION
    # =====================================================

    run([
        "colmap",
        "feature_extractor",

        "--database_path",
        database_path,

        "--image_path",
        image_dir,

        "--ImageReader.single_camera",
        "1"
    ])

    # =====================================================
    # 2. IMAGE MATCHING
    #
    # Since your browser captures sequential frames,
    # sequential matching is appropriate.
    # =====================================================

    run([
        "colmap",
        "sequential_matcher",

        "--database_path",
        database_path,

        "--SequentialMatching.overlap",
        "10"
    ])

    # =====================================================
    # 3. SPARSE RECONSTRUCTION
    # =====================================================

    run([
        "colmap",
        "mapper",

        "--database_path",
        database_path,

        "--image_path",
        image_dir,

        "--output_path",
        sparse_dir
    ])

    sparse_model = (
        sparse_dir /
        "0"
    )

    if not sparse_model.exists():
        raise RuntimeError(
            "COLMAP did not produce a sparse model."
        )

    # =====================================================
    # 4. IMAGE UNDISTORTION
    # =====================================================

    run([
        "colmap",
        "image_undistorter",

        "--image_path",
        image_dir,

        "--input_path",
        sparse_model,

        "--output_path",
        dense_dir,

        "--output_type",
        "COLMAP"
    ])

    # =====================================================
    # 5. DENSE DEPTH RECONSTRUCTION
    # =====================================================

    run([
        "colmap",
        "patch_match_stereo",

        "--workspace_path",
        dense_dir,

        "--workspace_format",
        "COLMAP",

        "--PatchMatchStereo.geom_consistency",
        "true"
    ])

    # =====================================================
    # 6. FUSE DEPTH MAPS INTO POINT CLOUD
    # =====================================================

    fused_path = (
        dense_dir /
        "fused.ply"
    )

    run([
        "colmap",
        "stereo_fusion",

        "--workspace_path",
        dense_dir,

        "--workspace_format",
        "COLMAP",

        "--input_type",
        "geometric",

        "--output_path",
        fused_path
    ])

    if not fused_path.exists():
        raise RuntimeError(
            "COLMAP did not produce fused.ply"
        )

    # =====================================================
    # 7. POISSON SURFACE MESH
    # =====================================================

    raw_mesh_path = (
        dense_dir /
        "raw-mesh.ply"
    )

    run([
        "colmap",
        "poisson_mesher",

        "--input_path",
        fused_path,

        "--output_path",
        raw_mesh_path
    ])

    if not raw_mesh_path.exists():
        raise RuntimeError(
            "COLMAP did not create a mesh."
        )

    return raw_mesh_path