from pathlib import Path

import numpy as np
import trimesh
import pymeshfix


def load_main_mesh(
    input_mesh: Path
) -> trimesh.Trimesh:

    mesh = trimesh.load(
        input_mesh,
        force="mesh"
    )

    if mesh.is_empty:
        raise RuntimeError(
            "Reconstructed mesh is empty."
        )

    mesh.remove_unreferenced_vertices()

    # Keep the largest connected component
    components = mesh.split(
        only_watertight=False
    )

    if not components:
        raise RuntimeError(
            "No usable mesh components found."
        )

    mesh = max(
        components,
        key=lambda part:
            len(part.faces)
    )

    mesh.remove_unreferenced_vertices()

    return mesh



def repair_mesh(
    mesh: trimesh.Trimesh
) -> trimesh.Trimesh:

    """
    Repair holes, bad triangles and orientation.
    """

    print(
        "Original mesh:"
    )

    print(
        "Vertices:",
        len(mesh.vertices)
    )

    print(
        "Faces:",
        len(mesh.faces)
    )

    print(
        "Watertight:",
        mesh.is_watertight
    )


    # -------------------------------------------------
    # Basic trimesh repair
    # -------------------------------------------------

    trimesh.repair.fix_normals(
        mesh
    )

    trimesh.repair.fix_winding(
        mesh
    )

    trimesh.repair.fill_holes(
        mesh
    )


    # -------------------------------------------------
    # MeshFix
    # -------------------------------------------------

    vertices = np.asarray(
        mesh.vertices,
        dtype=np.float64
    )

    faces = np.asarray(
        mesh.faces,
        dtype=np.int32
    )


    meshfix = pymeshfix.MeshFix(
        vertices,
        faces
    )


    meshfix.repair(
        verbose=False,
        joincomp=True,
        remove_smallest_components=True
    )


    repaired = trimesh.Trimesh(

        vertices=np.asarray(
            meshfix.v
        ),

        faces=np.asarray(
            meshfix.f
        ),

        process=True

    )


    repaired.remove_unreferenced_vertices()

    trimesh.repair.fix_normals(
        repaired
    )

    trimesh.repair.fix_winding(
        repaired
    )


    print(
        "After repair:"
    )

    print(
        "Vertices:",
        len(repaired.vertices)
    )

    print(
        "Faces:",
        len(repaired.faces)
    )

    print(
        "Watertight:",
        repaired.is_watertight
    )


    return repaired



def solidify_with_voxels(
    mesh: trimesh.Trimesh,
    resolution=350
) -> trimesh.Trimesh:

    """
    Convert the repaired surface into a filled volume.

    This is useful when the reconstructed mesh is still
    not reliably watertight.

    Higher resolution:
        more detail
        more RAM
        slower

    Lower resolution:
        smoother
        less detail
    """

    bounds = mesh.bounds

    size = (
        bounds[1] -
        bounds[0]
    )


    longest_dimension = float(
        np.max(size)
    )


    if longest_dimension <= 0:

        raise RuntimeError(
            "Invalid mesh dimensions."
        )


    pitch = (
        longest_dimension /
        resolution
    )


    print(
        "Voxel pitch:",
        pitch
    )


    voxel_grid = mesh.voxelized(
        pitch=pitch
    )


    # Fill inside the voxel shell
    filled = voxel_grid.fill()


    # Convert filled volume back to a surface mesh
    solid = filled.marching_cubes


    solid.remove_unreferenced_vertices()

    trimesh.repair.fix_normals(
        solid
    )

    trimesh.repair.fix_winding(
        solid
    )


    return solid



def smooth_mesh(
    mesh: trimesh.Trimesh,
    iterations=3
) -> trimesh.Trimesh:

    """
    Very light smoothing.

    Keep this low because too much smoothing will
    erase real ear detail.
    """

    try:

        trimesh.smoothing.filter_taubin(

            mesh,

            lamb=0.35,

            nu=-0.36,

            iterations=iterations

        )

    except Exception as error:

        print(
            "Smoothing skipped:",
            error
        )


    return mesh



def centre_mesh(
    mesh: trimesh.Trimesh
) -> trimesh.Trimesh:

    centre = mesh.bounding_box.centroid

    mesh.apply_translation(
        -centre
    )

    return mesh



def clean_mesh(
    input_mesh: Path,
    output_stl: Path,
    force_solid=True,
    voxel_resolution=350
) -> Path:

    """
    Main Hammer Craft ear processing function.

    Input:
        reconstructed PLY

    Output:
        closed solid STL
    """

    input_mesh = Path(
        input_mesh
    )

    output_stl = Path(
        output_stl
    )


    print(
        "\n======================================"
    )

    print(
        "HAMMER CRAFT EAR MESH CLEANUP"
    )

    print(
        "======================================"
    )


    # -------------------------------------------------
    # Load
    # -------------------------------------------------

    mesh = load_main_mesh(
        input_mesh
    )


    # -------------------------------------------------
    # Repair
    # -------------------------------------------------

    mesh = repair_mesh(
        mesh
    )


    # -------------------------------------------------
    # Force into a solid volume if necessary
    # -------------------------------------------------

    if (
        force_solid
        and
        not mesh.is_watertight
    ):

        print(
            "Mesh is still open."
        )

        print(
            "Creating filled voxel solid..."
        )


        mesh = solidify_with_voxels(

            mesh,

            resolution=
                voxel_resolution

        )


    # -------------------------------------------------
    # Light smoothing
    # -------------------------------------------------

    mesh = smooth_mesh(

        mesh,

        iterations=2

    )


    # -------------------------------------------------
    # Centre model
    # -------------------------------------------------

    mesh = centre_mesh(
        mesh
    )


    # -------------------------------------------------
    # Final checks
    # -------------------------------------------------

    mesh.remove_unreferenced_vertices()

    mesh.process(
        validate=True
    )


    print(
        "Final vertices:",
        len(mesh.vertices)
    )


    print(
        "Final faces:",
        len(mesh.faces)
    )


    print(
        "Final watertight:",
        mesh.is_watertight
    )


    if mesh.is_watertight:

        print(
            "Volume:",
            mesh.volume
        )

    else:

        print(
            "WARNING: final mesh is still not watertight."
        )


    # -------------------------------------------------
    # Export STL
    # -------------------------------------------------

    output_stl.parent.mkdir(

        parents=True,

        exist_ok=True

    )


    mesh.export(
        output_stl
    )


    print(
        "STL saved:",
        output_stl
    )


    return output_stl