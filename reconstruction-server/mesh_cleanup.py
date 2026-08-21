from pathlib import Path

import numpy as np
import trimesh
import pymeshfix


# =========================================================
# LOAD
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
            f"Input mesh not found: "
            f"{input_mesh}"
        )


    mesh = trimesh.load(
        input_mesh,
        force="mesh",
    )


    if mesh.is_empty:

        raise RuntimeError(
            "Reconstructed mesh is empty."
        )


    mesh.remove_unreferenced_vertices()


    components = mesh.split(
        only_watertight=False
    )


    if not components:

        raise RuntimeError(
            "No usable mesh components."
        )


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
# REPAIR
# =========================================================

def repair_mesh(
    mesh: trimesh.Trimesh
) -> trimesh.Trimesh:

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


    vertices = np.asarray(

        mesh.vertices,

        dtype=np.float64,

    )


    faces = np.asarray(

        mesh.faces,

        dtype=np.int32,

    )


    if (
        len(
            vertices
        )
        ==
        0
        or
        len(
            faces
        )
        ==
        0
    ):

        raise RuntimeError(
            "Mesh is empty before PyMeshFix."
        )


    if (
        not np.all(
            np.isfinite(
                vertices
            )
        )
    ):

        raise RuntimeError(
            "Mesh contains invalid coordinates."
        )


    meshfix = pymeshfix.MeshFix(

        vertices,

        faces,

    )


    # Installed PyMeshFix signature:
    #
    # repair(
    #   joincomp=False,
    #   remove_smallest_components=True
    # )

    meshfix.repair(

        joincomp=True,

        remove_smallest_components=True,

    )


    repaired_vertices = np.asarray(

        meshfix.v,

        dtype=np.float64,

    )


    repaired_faces = np.asarray(

        meshfix.f,

        dtype=np.int64,

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
            "PyMeshFix produced an empty mesh."
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


    try:

        trimesh.repair.fix_normals(
            repaired
        )

    except Exception:

        pass


    try:

        trimesh.repair.fix_winding(
            repaired
        )

    except Exception:

        pass


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
# VOXEL FALLBACK
# =========================================================

def solidify_with_voxels(
    mesh: trimesh.Trimesh,
    resolution=350,
) -> trimesh.Trimesh:

    bounds = np.asarray(

        mesh.bounds,

        dtype=np.float64,

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
            "Invalid mesh size."
        )


    pitch = (

        longest_dimension

        /

        float(
            resolution
        )

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
        pitch=pitch
    )


    filled = voxel_grid.fill()


    solid = (
        filled
        .marching_cubes
    )


    if solid.is_empty:

        raise RuntimeError(
            "Voxel solidification failed."
        )


    solid.remove_unreferenced_vertices()


    try:

        trimesh.repair.fix_normals(
            solid
        )

    except Exception:

        pass


    try:

        trimesh.repair.fix_winding(
            solid
        )

    except Exception:

        pass


    return solid


# =========================================================
# SMOOTH
# =========================================================

def smooth_mesh(
    mesh: trimesh.Trimesh,
    iterations=2,
) -> trimesh.Trimesh:

    if iterations <= 0:

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
# CENTRE
# =========================================================

def centre_mesh(
    mesh: trimesh.Trimesh
) -> trimesh.Trimesh:

    centre = np.asarray(

        mesh
        .bounding_box
        .centroid,

        dtype=np.float64,

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
# VALIDATION
# =========================================================

def validate_mesh(
    mesh: trimesh.Trimesh
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


    if (
        not np.all(
            np.isfinite(
                mesh.vertices
            )
        )
    ):

        raise RuntimeError(
            "Final mesh contains "
            "invalid coordinates."
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


    mesh = load_main_mesh(
        input_mesh
    )


    mesh = repair_mesh(
        mesh
    )


    if (
        force_solid
        and
        not mesh.is_watertight
    ):

        print(
            "Mesh remains open."
        )


        print(
            "Using voxel solidification fallback."
        )


        mesh = solidify_with_voxels(

            mesh,

            resolution=
                voxel_resolution,

        )


    mesh = smooth_mesh(

        mesh,

        iterations=
            2,

    )


    mesh = centre_mesh(
        mesh
    )


    mesh.remove_unreferenced_vertices()


    try:

        mesh.process(
            validate=True
        )

    except Exception as error:

        print(
            "Final processing warning:",
            error
        )


    validate_mesh(
        mesh
    )


    print(
        "Final vertices:",
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
        "STL saved:",
        output_stl
    )


    print(
        "STL size:",
        output_stl.stat().st_size,
        "bytes"
    )


    return output_stl