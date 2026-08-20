from pathlib import Path

import numpy as np
import trimesh
import pymeshfix


# =========================================================
# LOAD MAIN COMPONENT
# =========================================================

def load_main_mesh(
    input_mesh: Path
) -> trimesh.Trimesh:

    input_mesh = Path(
        input_mesh
    )

    if (
        not input_mesh.exists()
    ):

        raise RuntimeError(
            f"Input mesh does not exist: "
            f"{input_mesh}"
        )


    mesh = trimesh.load(
        input_mesh,
        force="mesh"
    )


    if (
        mesh.is_empty
    ):

        raise RuntimeError(
            "Reconstructed mesh is empty."
        )


    mesh.remove_unreferenced_vertices()


    # -----------------------------------------------------
    # Keep the largest connected component
    # -----------------------------------------------------

    components = mesh.split(
        only_watertight=False
    )


    if (
        not components
    ):

        raise RuntimeError(
            "No usable mesh components found."
        )


    mesh = max(
        components,
        key=lambda part:
            len(
                part.faces
            )
    )


    mesh.remove_unreferenced_vertices()


    if (
        len(
            mesh.vertices
        )
        <
        10
    ):

        raise RuntimeError(
            "Largest mesh component "
            "contains too few vertices."
        )


    if (
        len(
            mesh.faces
        )
        <
        10
    ):

        raise RuntimeError(
            "Largest mesh component "
            "contains too few faces."
        )


    return mesh


# =========================================================
# REPAIR MESH
# =========================================================

def repair_mesh(
    mesh: trimesh.Trimesh
) -> trimesh.Trimesh:

    """
    Repair:
        - normals
        - winding
        - simple holes
        - disconnected components
        - non-manifold / broken areas
    """

    print(
        "\n"
        "--------------------------------------"
    )

    print(
        "MESH REPAIR"
    )

    print(
        "--------------------------------------"
    )


    print(
        "Original vertices:",
        len(
            mesh.vertices
        )
    )


    print(
        "Original faces:",
        len(
            mesh.faces
        )
    )


    print(
        "Original watertight:",
        mesh.is_watertight
    )


    # -----------------------------------------------------
    # TRIMESH BASIC REPAIR
    # -----------------------------------------------------

    try:

        trimesh.repair.fix_normals(
            mesh
        )

    except Exception as error:

        print(
            "fix_normals skipped:",
            error
        )


    try:

        trimesh.repair.fix_winding(
            mesh
        )

    except Exception as error:

        print(
            "fix_winding skipped:",
            error
        )


    try:

        trimesh.repair.fill_holes(
            mesh
        )

    except Exception as error:

        print(
            "fill_holes skipped:",
            error
        )


    mesh.remove_unreferenced_vertices()


    # -----------------------------------------------------
    # VALIDATE INPUT TO MESHFIX
    # -----------------------------------------------------

    vertices = np.asarray(
        mesh.vertices,
        dtype=np.float64
    )


    faces = np.asarray(
        mesh.faces,
        dtype=np.int32
    )


    if (
        len(
            vertices
        )
        ==
        0
    ):

        raise RuntimeError(
            "Mesh contains no vertices "
            "before MeshFix."
        )


    if (
        len(
            faces
        )
        ==
        0
    ):

        raise RuntimeError(
            "Mesh contains no faces "
            "before MeshFix."
        )


    if (
        not np.all(
            np.isfinite(
                vertices
            )
        )
    ):

        raise RuntimeError(
            "Mesh contains invalid "
            "vertex coordinates."
        )


    # -----------------------------------------------------
    # MESHFIX
    #
    # Installed signature:
    #
    # repair(
    #     joincomp=False,
    #     remove_smallest_components=True
    # )
    #
    # DO NOT pass verbose=False.
    # -----------------------------------------------------

    print(
        "Running PyMeshFix..."
    )


    meshfix = pymeshfix.MeshFix(
        vertices,
        faces
    )


    meshfix.repair(
        joincomp=True,
        remove_smallest_components=True
    )


    repaired_vertices = np.asarray(
        meshfix.v,
        dtype=np.float64
    )


    repaired_faces = np.asarray(
        meshfix.f,
        dtype=np.int64
    )


    if (
        len(
            repaired_vertices
        )
        ==
        0
    ):

        raise RuntimeError(
            "MeshFix returned "
            "zero vertices."
        )


    if (
        len(
            repaired_faces
        )
        ==
        0
    ):

        raise RuntimeError(
            "MeshFix returned "
            "zero faces."
        )


    repaired = trimesh.Trimesh(

        vertices=
            repaired_vertices,

        faces=
            repaired_faces,

        process=
            True

    )


    repaired.remove_unreferenced_vertices()


    # -----------------------------------------------------
    # POST MESHFIX REPAIR
    # -----------------------------------------------------

    try:

        trimesh.repair.fix_normals(
            repaired
        )

    except Exception as error:

        print(
            "Post-MeshFix fix_normals skipped:",
            error
        )


    try:

        trimesh.repair.fix_winding(
            repaired
        )

    except Exception as error:

        print(
            "Post-MeshFix fix_winding skipped:",
            error
        )


    print(
        "After MeshFix vertices:",
        len(
            repaired.vertices
        )
    )


    print(
        "After MeshFix faces:",
        len(
            repaired.faces
        )
    )


    print(
        "After MeshFix watertight:",
        repaired.is_watertight
    )


    return repaired


# =========================================================
# VOXEL SOLIDIFICATION
# =========================================================

def solidify_with_voxels(
    mesh: trimesh.Trimesh,
    resolution=350
) -> trimesh.Trimesh:

    """
    Convert the surface into a filled voxel volume.

    This is used only when the repaired mesh
    is still not watertight.

    resolution:
        higher = more detail + more RAM
        lower = smoother + faster
    """

    print(
        "\n"
        "--------------------------------------"
    )

    print(
        "VOXEL SOLIDIFICATION"
    )

    print(
        "--------------------------------------"
    )


    if (
        resolution
        <
        50
    ):

        raise RuntimeError(
            "Voxel resolution is too low."
        )


    bounds = np.asarray(
        mesh.bounds,
        dtype=np.float64
    )


    if (
        bounds.shape
        !=
        (
            2,
            3
        )
    ):

        raise RuntimeError(
            "Invalid mesh bounds."
        )


    size = (
        bounds[1]
        -
        bounds[0]
    )


    longest_dimension = float(
        np.max(
            size
        )
    )


    if (
        not np.isfinite(
            longest_dimension
        )
        or
        longest_dimension
        <=
        0
    ):

        raise RuntimeError(
            "Invalid mesh dimensions."
        )


    pitch = (
        longest_dimension
        /
        float(
            resolution
        )
    )


    if (
        not np.isfinite(
            pitch
        )
        or
        pitch
        <=
        0
    ):

        raise RuntimeError(
            "Invalid voxel pitch."
        )


    print(
        "Voxel resolution:",
        resolution
    )


    print(
        "Longest mesh dimension:",
        longest_dimension
    )


    print(
        "Voxel pitch:",
        pitch
    )


    # -----------------------------------------------------
    # VOXELIZE
    # -----------------------------------------------------

    voxel_grid = mesh.voxelized(
        pitch=pitch
    )


    # -----------------------------------------------------
    # FILL INTERIOR
    # -----------------------------------------------------

    filled = (
        voxel_grid.fill()
    )


    # -----------------------------------------------------
    # MARCHING CUBES
    # -----------------------------------------------------

    solid = (
        filled.marching_cubes
    )


    if (
        solid.is_empty
    ):

        raise RuntimeError(
            "Voxel solidification "
            "produced an empty mesh."
        )


    solid.remove_unreferenced_vertices()


    try:

        trimesh.repair.fix_normals(
            solid
        )

    except Exception as error:

        print(
            "Voxel fix_normals skipped:",
            error
        )


    try:

        trimesh.repair.fix_winding(
            solid
        )

    except Exception as error:

        print(
            "Voxel fix_winding skipped:",
            error
        )


    print(
        "Voxel mesh vertices:",
        len(
            solid.vertices
        )
    )


    print(
        "Voxel mesh faces:",
        len(
            solid.faces
        )
    )


    print(
        "Voxel mesh watertight:",
        solid.is_watertight
    )


    return solid


# =========================================================
# LIGHT SMOOTHING
# =========================================================

def smooth_mesh(
    mesh: trimesh.Trimesh,
    iterations=2
) -> trimesh.Trimesh:

    """
    Light Taubin smoothing.

    Keep this conservative because ear
    geometry contains fine detail.
    """

    if (
        iterations
        <=
        0
    ):

        return mesh


    print(
        "\n"
        "Smoothing mesh..."
    )


    try:

        trimesh.smoothing.filter_taubin(

            mesh,

            lamb=
                0.35,

            nu=
                -0.36,

            iterations=
                iterations

        )


    except Exception as error:

        print(
            "Smoothing skipped:",
            error
        )


    return mesh


# =========================================================
# CENTRE MESH
# =========================================================

def centre_mesh(
    mesh: trimesh.Trimesh
) -> trimesh.Trimesh:

    centre = np.asarray(
        mesh.bounding_box.centroid,
        dtype=np.float64
    )


    if (
        centre.shape
        !=
        (
            3,
        )
    ):

        raise RuntimeError(
            "Unable to determine "
            "mesh centre."
        )


    if (
        not np.all(
            np.isfinite(
                centre
            )
        )
    ):

        raise RuntimeError(
            "Mesh centre contains "
            "invalid values."
        )


    mesh.apply_translation(
        -centre
    )


    return mesh


# =========================================================
# VALIDATE FINAL MESH
# =========================================================

def validate_mesh(
    mesh: trimesh.Trimesh
):

    if (
        mesh.is_empty
    ):

        raise RuntimeError(
            "Final mesh is empty."
        )


    if (
        len(
            mesh.vertices
        )
        <
        10
    ):

        raise RuntimeError(
            "Final mesh contains "
            "too few vertices."
        )


    if (
        len(
            mesh.faces
        )
        <
        10
    ):

        raise RuntimeError(
            "Final mesh contains "
            "too few faces."
        )


    vertices = np.asarray(
        mesh.vertices
    )


    if (
        not np.all(
            np.isfinite(
                vertices
            )
        )
    ):

        raise RuntimeError(
            "Final mesh contains "
            "invalid coordinates."
        )


    bounds = np.asarray(
        mesh.bounds
    )


    if (
        not np.all(
            np.isfinite(
                bounds
            )
        )
    ):

        raise RuntimeError(
            "Final mesh has "
            "invalid bounds."
        )


# =========================================================
# CLEAN MESH
# =========================================================

def clean_mesh(
    input_mesh: Path,
    output_stl: Path,
    force_solid=True,
    voxel_resolution=350
) -> Path:

    """
    Hammer Craft ear mesh cleanup.

    Input:
        reconstructed PLY / mesh

    Output:
        repaired STL
    """

    input_mesh = Path(
        input_mesh
    )


    output_stl = Path(
        output_stl
    )


    print(
        "\n"
        "======================================"
    )

    print(
        "HAMMER CRAFT EAR MESH CLEANUP"
    )

    print(
        "======================================"
    )


    print(
        "Input mesh:",
        input_mesh
    )


    print(
        "Output STL:",
        output_stl
    )


    # -----------------------------------------------------
    # 1. LOAD MAIN COMPONENT
    # -----------------------------------------------------

    mesh = load_main_mesh(
        input_mesh
    )


    # -----------------------------------------------------
    # 2. REPAIR
    # -----------------------------------------------------

    mesh = repair_mesh(
        mesh
    )


    # -----------------------------------------------------
    # 3. SOLIDIFY IF REQUIRED
    # -----------------------------------------------------

    if (
        force_solid
        and
        not mesh.is_watertight
    ):

        print(
            "\nMesh is still open."
        )

        print(
            "Creating filled voxel solid..."
        )


        mesh = solidify_with_voxels(

            mesh,

            resolution=
                voxel_resolution

        )


    # -----------------------------------------------------
    # 4. LIGHT SMOOTHING
    # -----------------------------------------------------

    mesh = smooth_mesh(

        mesh,

        iterations=
            2

    )


    # -----------------------------------------------------
    # 5. CENTRE
    # -----------------------------------------------------

    mesh = centre_mesh(
        mesh
    )


    # -----------------------------------------------------
    # 6. FINAL TRIMESH PROCESS
    # -----------------------------------------------------

    mesh.remove_unreferenced_vertices()


    try:

        mesh.process(
            validate=True
        )

    except Exception as error:

        print(
            "Final trimesh processing warning:",
            error
        )


    # -----------------------------------------------------
    # 7. VALIDATE
    # -----------------------------------------------------

    validate_mesh(
        mesh
    )


    # -----------------------------------------------------
    # INFORMATION
    # -----------------------------------------------------

    print(
        "\n"
        "--------------------------------------"
    )

    print(
        "FINAL MESH"
    )

    print(
        "--------------------------------------"
    )


    print(
        "Vertices:",
        len(
            mesh.vertices
        )
    )


    print(
        "Faces:",
        len(
            mesh.faces
        )
    )


    print(
        "Watertight:",
        mesh.is_watertight
    )


    print(
        "Bounds:"
    )


    print(
        mesh.bounds
    )


    print(
        "Dimensions:"
    )


    print(
        mesh.extents
    )


    if (
        mesh.is_watertight
    ):

        try:

            print(
                "Volume:",
                mesh.volume
            )

        except Exception as error:

            print(
                "Volume unavailable:",
                error
            )


    else:

        print(
            "WARNING: final mesh "
            "is still not watertight."
        )


    # -----------------------------------------------------
    # 8. EXPORT STL
    # -----------------------------------------------------

    output_stl.parent.mkdir(

        parents=True,

        exist_ok=True

    )


    mesh.export(
        output_stl
    )


    if (
        not output_stl.exists()
    ):

        raise RuntimeError(
            "STL export failed."
        )


    if (
        output_stl.stat().st_size
        <=
        0
    ):

        raise RuntimeError(
            "Exported STL is empty."
        )


    print(
        "\nSTL saved:"
    )


    print(
        output_stl
    )


    print(
        "STL size:",
        output_stl.stat().st_size,
        "bytes"
    )


    return output_stl