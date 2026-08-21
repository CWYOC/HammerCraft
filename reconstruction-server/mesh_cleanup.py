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

        force=
            "mesh",

    )


    if mesh.is_empty:

        raise RuntimeError(
            "Reconstructed mesh is empty."
        )


    mesh.remove_unreferenced_vertices()


    components = mesh.split(
        only_watertight=
            False
    )


    if (
        not components
    ):

        raise RuntimeError(
            "No usable mesh components found."
        )


    # Keep biggest reconstructed object.

    mesh = max(

        components,

        key=lambda part:
            len(
                part.faces
            ),

    )


    mesh.remove_unreferenced_vertices()


    return mesh


# =========================================================
# BASIC REPAIR
# =========================================================

def trimesh_basic_repair(
    mesh
):

    try:

        trimesh.repair.fix_normals(
            mesh
        )


    except Exception as error:

        print(
            "fix_normals warning:",
            error
        )


    try:

        trimesh.repair.fix_winding(
            mesh
        )


    except Exception as error:

        print(
            "fix_winding warning:",
            error
        )


    try:

        trimesh.repair.fill_holes(
            mesh
        )


    except Exception as error:

        print(
            "fill_holes warning:",
            error
        )


    mesh.remove_unreferenced_vertices()


    return mesh


# =========================================================
# PYMeshFix
# =========================================================

def repair_mesh(
    mesh: trimesh.Trimesh
) -> trimesh.Trimesh:

    print(
        "\n"
        "======================================"
    )


    print(
        "MESH REPAIR"
    )


    print(
        "======================================"
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
    # TRIMESH
    # -----------------------------------------------------

    mesh = trimesh_basic_repair(
        mesh
    )


    vertices = np.asarray(

        mesh.vertices,

        dtype=
            np.float64,

    )


    faces = np.asarray(

        mesh.faces,

        dtype=
            np.int32,

    )


    if (
        len(
            vertices
        )
        ==
        0
    ):

        raise RuntimeError(
            "Mesh has no vertices."
        )


    if (
        len(
            faces
        )
        ==
        0
    ):

        raise RuntimeError(
            "Mesh has no faces."
        )


    if (
        not np.all(
            np.isfinite(
                vertices
            )
        )
    ):

        raise RuntimeError(

            "Mesh contains "
            "invalid coordinates."

        )


    # -----------------------------------------------------
    # PYMeshFix
    # -----------------------------------------------------

    print(
        "Running PyMeshFix..."
    )


    meshfix = pymeshfix.MeshFix(

        vertices,

        faces,

    )


    # Your installed version reports:
    #
    # MeshFix.repair(
    #   self,
    #   joincomp=False,
    #   remove_smallest_components=True
    # )
    #
    # Therefore do NOT use verbose=.

    meshfix.repair(

        joincomp=
            True,

        remove_smallest_components=
            True,

    )


    repaired_vertices = np.asarray(

        meshfix.v,

        dtype=
            np.float64,

    )


    repaired_faces = np.asarray(

        meshfix.f,

        dtype=
            np.int64,

    )


    if (
        len(
            repaired_vertices
        )
        ==
        0
        or
        len(
            repaired_faces
        )
        ==
        0
    ):

        raise RuntimeError(

            "PyMeshFix produced "
            "an empty mesh."

        )


    repaired = trimesh.Trimesh(

        vertices=
            repaired_vertices,

        faces=
            repaired_faces,

        process=
            True,

    )


    repaired.remove_unreferenced_vertices()


    repaired = trimesh_basic_repair(
        repaired
    )


    print(
        "After repair vertices:",
        len(
            repaired.vertices
        )
    )


    print(
        "After repair faces:",
        len(
            repaired.faces
        )
    )


    print(
        "After repair watertight:",
        repaired.is_watertight
    )


    return repaired


# =========================================================
# VOXEL SOLIDIFICATION
# =========================================================

def solidify_with_voxels(
    mesh: trimesh.Trimesh,
    resolution=350,
) -> trimesh.Trimesh:

    print(
        "\n"
        "======================================"
    )


    print(
        "VOXEL SOLIDIFICATION"
    )


    print(
        "======================================"
    )


    bounds = np.asarray(

        mesh.bounds,

        dtype=
            np.float64,

    )


    dimensions = (

        bounds[
            1
        ]

        -

        bounds[
            0
        ]

    )


    longest_dimension = float(

        np.max(
            dimensions
        )

    )


    if (
        not np.isfinite(
            longest_dimension
        )
        or
        longest_dimension <=
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
        pitch <=
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
        "Voxel pitch:",
        pitch
    )


    voxel_grid = mesh.voxelized(

        pitch=
            pitch

    )


    filled = voxel_grid.fill()


    solid = (
        filled
        .marching_cubes
    )


    if solid.is_empty:

        raise RuntimeError(

            "Voxel conversion "
            "produced an empty mesh."

        )


    solid.remove_unreferenced_vertices()


    solid = trimesh_basic_repair(
        solid
    )


    print(
        "Voxel solid vertices:",
        len(
            solid.vertices
        )
    )


    print(
        "Voxel solid faces:",
        len(
            solid.faces
        )
    )


    print(
        "Voxel solid watertight:",
        solid.is_watertight
    )


    return solid


# =========================================================
# LIGHT SMOOTHING
# =========================================================

def smooth_mesh(
    mesh: trimesh.Trimesh,
    iterations=2,
) -> trimesh.Trimesh:

    if (
        iterations <=
        0
    ):

        return mesh


    try:

        trimesh.smoothing.filter_taubin(

            mesh,

            lamb=
                0.35,

            nu=
                -0.36,

            iterations=
                iterations,

        )


    except Exception as error:

        print(
            "Smoothing warning:",
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

        mesh
        .bounding_box
        .centroid,

        dtype=
            np.float64,

    )


    if (
        not np.all(
            np.isfinite(
                centre
            )
        )
    ):

        raise RuntimeError(
            "Invalid mesh centre."
        )


    mesh.apply_translation(
        -centre
    )


    return mesh


# =========================================================
# FINAL VALIDATION
# =========================================================

def validate_mesh(
    mesh
):

    if mesh.is_empty:

        raise RuntimeError(
            "Final mesh is empty."
        )


    if (
        len(
            mesh.vertices
        )
        <
        100
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
        100
    ):

        raise RuntimeError(

            "Final mesh contains "
            "too few faces."

        )


    vertices = np.asarray(

        mesh.vertices,

        dtype=
            np.float64,

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


    dimensions = np.asarray(

        mesh.extents,

        dtype=
            np.float64,

    )


    if (
        not np.all(
            np.isfinite(
                dimensions
            )
        )
    ):

        raise RuntimeError(
            "Final mesh dimensions are invalid."
        )


    if (
        np.max(
            dimensions
        )
        <=
        0
    ):

        raise RuntimeError(
            "Final mesh has zero size."
        )


# =========================================================
# MAIN CLEANUP
# =========================================================

def clean_mesh(
    input_mesh: Path,
    output_stl: Path,
    force_solid=True,
    voxel_resolution=350,
) -> Path:

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
        "Input:",
        input_mesh
    )


    print(
        "Output:",
        output_stl
    )


    # =====================================================
    # LOAD
    # =====================================================

    mesh = load_main_mesh(
        input_mesh
    )


    # =====================================================
    # REPAIR
    # =====================================================

    mesh = repair_mesh(
        mesh
    )


    # =====================================================
    # FORCE SOLID IF STILL OPEN
    # =====================================================

    if (
        force_solid
        and
        not mesh.is_watertight
    ):

        print(
            "\nMesh remains open."
        )


        print(
            "Using voxel solidification fallback."
        )


        mesh = solidify_with_voxels(

            mesh,

            resolution=
                voxel_resolution,

        )


    # =====================================================
    # SMOOTH
    # =====================================================

    mesh = smooth_mesh(

        mesh,

        iterations=
            2,

    )


    # =====================================================
    # CENTRE
    # =====================================================

    mesh = centre_mesh(
        mesh
    )


    # =====================================================
    # FINAL PROCESSING
    # =====================================================

    mesh.remove_unreferenced_vertices()


    try:

        mesh.process(
            validate=True
        )


    except Exception as error:

        print(
            "Final mesh processing warning:",
            error
        )


    # =====================================================
    # VALIDATE
    # =====================================================

    validate_mesh(
        mesh
    )


    print(
        "\nFinal vertices:",
        len(
            mesh.vertices
        )
    )


    print(
        "Final faces:",
        len(
            mesh.faces
        )
    )


    print(
        "Final watertight:",
        mesh.is_watertight
    )


    print(
        "Final dimensions:",
        mesh.extents
    )


    if mesh.is_watertight:

        try:

            print(
                "Final volume:",
                mesh.volume
            )


        except Exception:

            pass


    # =====================================================
    # EXPORT
    # =====================================================

    output_stl.parent.mkdir(

        parents=True,

        exist_ok=True,

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
        "\nSTL saved:",
        output_stl
    )


    print(
        "STL size:",
        output_stl.stat().st_size,
        "bytes"
    )


    return output_stl