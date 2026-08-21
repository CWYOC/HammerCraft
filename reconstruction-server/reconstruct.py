from pathlib import Path

import os
import shutil
import subprocess


# =========================================================
# CONFIGURATION
# =========================================================

MAX_RECONSTRUCTION_IMAGE_SIZE = int(
    os.getenv(
        "MAX_RECONSTRUCTION_IMAGE_SIZE",
        "1800",
    )
)


MIN_REGISTRATION_RATIO = float(
    os.getenv(
        "MIN_REGISTRATION_RATIO",
        "0.65",
    )
)


# =========================================================
# RUN EXTERNAL COMMAND
# =========================================================

def run(
    command
):

    command = [
        str(
            item
        )
        for item
        in command
    ]


    print(
        "\n"
        "================================================="
    )


    print(
        "RUNNING:"
    )


    print(
        " ".join(
            command
        )
    )


    print(
        "================================================="
        "\n"
    )


    process = subprocess.Popen(

        command,

        stdout=subprocess.PIPE,

        stderr=subprocess.STDOUT,

        text=True,

        bufsize=1,

    )


    output = []


    if process.stdout:

        for line in process.stdout:

            print(
                line,
                end="",
                flush=True,
            )


            output.append(
                line
            )


    return_code = (
        process.wait()
    )


    if (
        return_code !=
        0
    ):

        text = "".join(
            output
        )


        raise RuntimeError(

            f"Command failed with "
            f"exit code "
            f"{return_code}\n\n"

            f"COMMAND:\n"
            f"{' '.join(command)}\n\n"

            f"OUTPUT:\n"
            f"{text[-12000:]}"

        )


# =========================================================
# IMAGE LIST
# =========================================================

def get_images(
    directory
):

    directory = Path(
        directory
    )


    images = []


    for pattern in (

        "*.jpg",
        "*.jpeg",
        "*.JPG",
        "*.JPEG",
        "*.png",
        "*.PNG",

    ):

        images.extend(
            directory.glob(
                pattern
            )
        )


    return sorted(
        set(
            images
        )
    )


# =========================================================
# CONVERT COLMAP MODEL TO TEXT
# =========================================================

def convert_model_to_text(
    model_path,
    output_path,
):

    model_path = Path(
        model_path
    )


    output_path = Path(
        output_path
    )


    if output_path.exists():

        shutil.rmtree(
            output_path
        )


    output_path.mkdir(
        parents=True,
        exist_ok=True,
    )


    run([

        "colmap",
        "model_converter",

        "--input_path",
        model_path,

        "--output_path",
        output_path,

        "--output_type",
        "TXT",

    ])


# =========================================================
# COUNT REGISTERED IMAGES
# =========================================================

def count_registered_images(
    images_txt
):

    images_txt = Path(
        images_txt
    )


    if (
        not images_txt.exists()
    ):

        return 0


    data_lines = []


    with open(
        images_txt,
        "r",
        encoding="utf-8",
    ) as file:

        for line in file:

            stripped = (
                line.strip()
            )


            if (
                not stripped
                or
                stripped.startswith(
                    "#"
                )
            ):

                continue


            data_lines.append(
                stripped
            )


    # COLMAP images.txt:
    #
    # line 1 = image metadata
    # line 2 = 2D observations
    #
    # Therefore approximately two lines per
    # registered image.

    return (
        len(
            data_lines
        )
        //
        2
    )


# =========================================================
# FEATURE EXTRACTION
# =========================================================

def extract_features(
    image_dir,
    database,
):

    run([

        "colmap",
        "feature_extractor",

        "--database_path",
        database,

        "--image_path",
        image_dir,

        "--ImageReader.single_camera",
        "1",

        # Your Mac COLMAP build reports:
        # "without CUDA".
        #
        # Keep COLMAP SIFT on CPU.
        "--FeatureExtraction.use_gpu",
        "0",

    ])


# =========================================================
# MATCHING
# =========================================================

def match_images(
    database,
    matcher,
    overlap,
):

    if (
        matcher ==
        "sequential"
    ):

        run([

            "colmap",
            "sequential_matcher",

            "--database_path",
            database,

            "--SequentialMatching.overlap",
            str(
                overlap
            ),

            "--FeatureMatching.use_gpu",
            "0",

        ])


    elif (
        matcher ==
        "exhaustive"
    ):

        run([

            "colmap",
            "exhaustive_matcher",

            "--database_path",
            database,

            "--FeatureMatching.use_gpu",
            "0",

        ])


    else:

        raise RuntimeError(
            f"Unknown matcher: "
            f"{matcher}"
        )


# =========================================================
# RUN ONE SPARSE ATTEMPT
# =========================================================

def run_sparse_attempt(
    image_dir,
    attempt_dir,
    matcher,
    overlap,
):

    image_dir = Path(
        image_dir
    )


    attempt_dir = Path(
        attempt_dir
    )


    if attempt_dir.exists():

        shutil.rmtree(
            attempt_dir
        )


    attempt_dir.mkdir(
        parents=True,
        exist_ok=True,
    )


    database = (
        attempt_dir
        /
        "database.db"
    )


    sparse_dir = (
        attempt_dir
        /
        "sparse"
    )


    sparse_dir.mkdir(
        parents=True,
        exist_ok=True,
    )


    # -----------------------------------------------------
    # FEATURES
    # -----------------------------------------------------

    extract_features(
        image_dir,
        database,
    )


    # -----------------------------------------------------
    # MATCHING
    # -----------------------------------------------------

    match_images(
        database,
        matcher,
        overlap,
    )


    # -----------------------------------------------------
    # MAPPING
    # -----------------------------------------------------

    run([

        "colmap",
        "mapper",

        "--database_path",
        database,

        "--image_path",
        image_dir,

        "--output_path",
        sparse_dir,

    ])


    model = (
        sparse_dir
        /
        "0"
    )


    if (
        not model.exists()
    ):

        return None


    return model


# =========================================================
# STABLE CAMERA RECONSTRUCTION
# =========================================================

def find_best_sparse_model(
    image_dir,
    workspace,
    progress_callback=None,
):

    image_dir = Path(
        image_dir
    )


    workspace = Path(
        workspace
    )


    input_images = get_images(
        image_dir
    )


    input_count = len(
        input_images
    )


    if (
        input_count <
        20
    ):

        raise RuntimeError(

            f"Only "
            f"{input_count} images found. "

            f"Too few for reliable reconstruction."

        )


    attempts = [

        (
            "sequential",
            15,
        ),

        (
            "sequential",
            25,
        ),

        (
            "exhaustive",
            0,
        ),

    ]


    best_model = None

    best_registered = 0

    best_ratio = 0.0


    for (
        attempt_number,
        (
            matcher,
            overlap,
        ),
    ) in enumerate(
        attempts,
        start=1,
    ):

        print(
            "\n"
            "=============================================="
        )


        print(
            "COLMAP CAMERA ATTEMPT:",
            attempt_number
        )


        print(
            "Matcher:",
            matcher
        )


        if (
            matcher ==
            "sequential"
        ):

            print(
                "Overlap:",
                overlap
            )


        print(
            "=============================================="
        )


        if progress_callback:

            progress_callback(

                5
                +
                attempt_number
                *
                7,

                f"Camera registration attempt "
                f"{attempt_number}",

                "COLMAP / CPU",

            )


        attempt_dir = (

            workspace
            /
            f"sparse_attempt_"
            f"{attempt_number}"

        )


        try:

            model = run_sparse_attempt(

                image_dir,

                attempt_dir,

                matcher,

                overlap,

            )


        except Exception as error:

            print(
                "COLMAP attempt failed:"
            )


            print(
                error
            )


            continue


        if (
            model is None
        ):

            print(
                "No sparse model produced."
            )

            continue


        text_dir = (
            attempt_dir
            /
            "text"
        )


        convert_model_to_text(

            model,

            text_dir,

        )


        registered = count_registered_images(

            text_dir
            /
            "images.txt"

        )


        ratio = (

            registered

            /

            max(
                input_count,
                1,
            )

        )


        print(
            "Registered images:",
            registered,
            "/",
            input_count,
        )


        print(
            "Registration ratio:",
            f"{ratio:.1%}"
        )


        if (
            registered >
            best_registered
        ):

            best_model = (
                model
            )


            best_registered = (
                registered
            )


            best_ratio = (
                ratio
            )


        if (
            ratio >=
            MIN_REGISTRATION_RATIO
        ):

            print(
                "Registration quality accepted."
            )


            return (

                model,

                registered,

                input_count,

            )


    # -----------------------------------------------------
    # NOTHING WORKED
    # -----------------------------------------------------

    if (
        best_model is None
    ):

        raise RuntimeError(

            "COLMAP could not create "
            "a sparse camera reconstruction."

        )


    if (
        best_ratio <
        MIN_REGISTRATION_RATIO
    ):

        raise RuntimeError(

            f"Camera registration too low. "

            f"{best_registered}/"
            f"{input_count} images registered "

            f"({best_ratio:.0%}). "

            f"Minimum required is "
            f"{MIN_REGISTRATION_RATIO:.0%}. "

            f"The scan probably needs "
            f"better overlap, lighting or focus."

        )


    return (

        best_model,

        best_registered,

        input_count,

    )


# =========================================================
# DENSE RECONSTRUCTION
# =========================================================

def reconstruct(
    image_dir: Path,
    workspace: Path,
    progress_callback=None,
) -> Path:

    image_dir = Path(
        image_dir
    )


    workspace = Path(
        workspace
    )


    images = get_images(
        image_dir
    )


    if (
        len(
            images
        )
        <
        20
    ):

        raise RuntimeError(

            f"Only "
            f"{len(images)} images found."

        )


    if workspace.exists():

        shutil.rmtree(
            workspace
        )


    workspace.mkdir(
        parents=True,
        exist_ok=True,
    )


    print(
        "\n"
        "=============================================="
    )


    print(
        " HAMMER CRAFT EAR RECONSTRUCTION"
    )


    print(
        "=============================================="
    )


    print(
        "Images:",
        len(
            images
        )
    )


    # =====================================================
    # 1. CAMERA REGISTRATION
    # =====================================================

    if progress_callback:

        progress_callback(

            3,

            "Preparing camera reconstruction",

            "COLMAP / CPU",

        )


    (
        sparse_model,
        registered,
        total,
    ) = find_best_sparse_model(

        image_dir,

        workspace,

        progress_callback,

    )


    print(
        "Final camera registration:",
        registered,
        "/",
        total
    )


    # =====================================================
    # 2. UNDISTORT
    # =====================================================

    dense_dir = (
        workspace
        /
        "dense"
    )


    if dense_dir.exists():

        shutil.rmtree(
            dense_dir
        )


    if progress_callback:

        progress_callback(

            38,

            "Undistorting registered photographs",

            "COLMAP / CPU",

        )


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
        "COLMAP",

        "--max_image_size",
        str(
            MAX_RECONSTRUCTION_IMAGE_SIZE
        ),

    ])


    if (
        not (
            dense_dir
            /
            "images"
        ).exists()
    ):

        raise RuntimeError(

            "COLMAP did not create "
            "undistorted images."

        )


    # =====================================================
    # 3. PATCH MATCH STEREO
    # =====================================================

    if progress_callback:

        progress_callback(

            52,

            "Building dense stereo depth maps",

            "COLMAP / CPU",

        )


    run([

        "colmap",
        "patch_match_stereo",

        "--workspace_path",
        dense_dir,

        "--workspace_format",
        "COLMAP",

        "--PatchMatchStereo.geom_consistency",
        "true",

    ])


    # =====================================================
    # 4. FUSE POINT CLOUD
    # =====================================================

    fused_path = (
        dense_dir
        /
        "fused.ply"
    )


    if progress_callback:

        progress_callback(

            76,

            "Fusing ear geometry",

            "COLMAP / CPU",

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
        fused_path,

    ])


    if (
        not fused_path.exists()
    ):

        raise RuntimeError(

            "COLMAP did not create "
            "fused.ply."

        )


    if (
        fused_path.stat().st_size
        <=
        0
    ):

        raise RuntimeError(
            "COLMAP fused point cloud is empty."
        )


    # =====================================================
    # 5. POISSON MESH
    # =====================================================

    raw_mesh_path = (
        dense_dir
        /
        "raw-mesh.ply"
    )


    if progress_callback:

        progress_callback(

            90,

            "Generating ear surface mesh",

            "COLMAP / CPU",

        )


    run([

        "colmap",
        "poisson_mesher",

        "--input_path",
        fused_path,

        "--output_path",
        raw_mesh_path,

    ])


    if (
        not raw_mesh_path.exists()
    ):

        raise RuntimeError(

            "COLMAP did not create "
            "raw-mesh.ply."

        )


    if (
        raw_mesh_path.stat().st_size
        <=
        0
    ):

        raise RuntimeError(
            "COLMAP raw mesh is empty."
        )


    if progress_callback:

        progress_callback(

            100,

            "Raw ear mesh complete",

            "COLMAP / CPU",

        )


    print(
        "\nRaw mesh:",
        raw_mesh_path
    )


    return raw_mesh_path