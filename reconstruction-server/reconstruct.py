from pathlib import Path

import math
import os
import platform
import shutil
import subprocess

import numpy as np
import open3d as o3d
import torch

from PIL import Image

from transformers import (
    AutoImageProcessor,
    AutoModelForDepthEstimation,
)


# =========================================================
# CONFIGURATION
# =========================================================

DEPTH_MODEL_NAME = os.getenv(
    "DEPTH_MODEL",
    "depth-anything/Depth-Anything-V2-Small-hf",
)


MAX_DEPTH_VIEWS = int(
    os.getenv(
        "MAX_DEPTH_VIEWS",
        "72",
    )
)


MIN_REGISTRATION_RATIO = float(
    os.getenv(
        "MIN_REGISTRATION_RATIO",
        "0.65",
    )
)


MAX_RECONSTRUCTION_IMAGE_SIZE = int(
    os.getenv(
        "MAX_RECONSTRUCTION_IMAGE_SIZE",
        "1800",
    )
)


POINT_STRIDE = int(
    os.getenv(
        "POINT_STRIDE",
        "5",
    )
)


MIN_SPARSE_ALIGNMENT_POINTS = int(
    os.getenv(
        "MIN_SPARSE_ALIGNMENT_POINTS",
        "8",
    )
)


VOXEL_SIZE_RATIO = float(
    os.getenv(
        "VOXEL_SIZE_RATIO",
        "0.0025",
    )
)


MESH_POISSON_DEPTH = int(
    os.getenv(
        "MESH_POISSON_DEPTH",
        "9",
    )
)


MESH_DENSITY_QUANTILE = float(
    os.getenv(
        "MESH_DENSITY_QUANTILE",
        "0.03",
    )
)


# =========================================================
# DEVICE
# =========================================================

def select_device():

    if torch.cuda.is_available():

        return torch.device(
            "cuda"
        )


    if (
        hasattr(
            torch.backends,
            "mps",
        )
        and
        torch.backends.mps.is_built()
        and
        torch.backends.mps.is_available()
    ):

        return torch.device(
            "mps"
        )


    return torch.device(
        "cpu"
    )


DEVICE = select_device()


def accelerator_name():

    if DEVICE.type == "cuda":

        try:

            return (
                "CUDA — "
                +
                torch.cuda.get_device_name(
                    0
                )
            )

        except Exception:

            return "CUDA"


    if DEVICE.type == "mps":

        return (
            "MPS / Apple Metal"
        )


    return "CPU"


# =========================================================
# PROGRESS
# =========================================================

def report(
    callback,
    percent,
    text,
):

    accelerator = (
        accelerator_name()
    )


    print(
        f"[RECONSTRUCTION {percent}%] "
        f"{text} "
        f"[{accelerator}]",
        flush=True,
    )


    if callback:

        try:

            callback(
                percent,
                text,
                accelerator,
            )

        except TypeError:

            callback(
                percent,
                text,
            )


# =========================================================
# EXTERNAL COMMAND
# =========================================================

def run(
    command,
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


    assert process.stdout is not None


    for line in process.stdout:

        print(
            line,
            end="",
            flush=True,
        )


        output.append(
            line
        )


    code = (
        process.wait()
    )


    if code != 0:

        text = "".join(
            output
        )


        raise RuntimeError(

            f"External command failed "
            f"with exit code "
            f"{code}\n\n"

            f"COMMAND:\n"
            f"{' '.join(command)}\n\n"

            f"OUTPUT:\n"
            f"{text[-12000:]}"

        )


# =========================================================
# FIND IMAGES
# =========================================================

def get_images(
    directory,
):

    directory = Path(
        directory
    )


    result = []


    for pattern in (

        "*.jpg",
        "*.jpeg",
        "*.JPG",
        "*.JPEG",
        "*.png",
        "*.PNG",

    ):

        result.extend(
            directory.glob(
                pattern
            )
        )


    return sorted(
        set(
            result
        )
    )


# =========================================================
# COLMAP CUDA SUPPORT
# =========================================================

def use_colmap_gpu():

    # COLMAP SIFT can use CUDA on supported NVIDIA systems.
    # Apple MPS is not a COLMAP CUDA device.

    return (
        DEVICE.type ==
        "cuda"
    )


# =========================================================
# CONVERT COLMAP MODEL
# =========================================================

def convert_to_text(
    model,
    destination,
):

    destination = Path(
        destination
    )


    if destination.exists():

        shutil.rmtree(
            destination
        )


    destination.mkdir(
        parents=True,
        exist_ok=True,
    )


    run([

        "colmap",
        "model_converter",

        "--input_path",
        model,

        "--output_path",
        destination,

        "--output_type",
        "TXT",

    ])


    return destination


# =========================================================
# READ REGISTERED IMAGE NAMES
# =========================================================

def read_registered_names(
    images_txt,
):

    names = []


    with open(
        images_txt,
        "r",
        encoding="utf-8",
    ) as file:

        lines = file.readlines()


    data_lines = [

        line.rstrip(
            "\n"
        )

        for line in lines

        if (
            line.strip()
            and
            not line.startswith(
                "#"
            )
        )

    ]


    index = 0


    while (
        index <
        len(
            data_lines
        )
    ):

        header = (
            data_lines[
                index
            ]
            .strip()
        )


        index += 1


        pieces = header.split()


        if (
            len(
                pieces
            )
            >=
            10
        ):

            names.append(
                " ".join(
                    pieces[
                        9:
                    ]
                )
            )


        # observations line
        if (
            index <
            len(
                data_lines
            )
        ):

            index += 1


    return names


# =========================================================
# COLMAP ATTEMPT
# =========================================================

def run_colmap_attempt(
    image_dir,
    workspace,
    matcher,
    overlap,
    callback,
):

    workspace = Path(
        workspace
    )


    database = (
        workspace
        /
        "database.db"
    )


    sparse = (
        workspace
        /
        "sparse"
    )


    workspace.mkdir(
        parents=True,
        exist_ok=True,
    )


    if database.exists():

        database.unlink()


    if sparse.exists():

        shutil.rmtree(
            sparse
        )


    sparse.mkdir(
        parents=True,
        exist_ok=True,
    )


    gpu = (
        "1"
        if use_colmap_gpu()
        else "0"
    )


    report(
        callback,
        5,
        "Extracting image features",
    )


    run([

        "colmap",
        "feature_extractor",

        "--database_path",
        database,

        "--image_path",
        image_dir,

        "--ImageReader.single_camera",
        "1",

        "--FeatureExtraction.use_gpu",
        gpu,

    ])


    report(
        callback,
        14,
        (
            "Sequential image matching"
            if matcher ==
            "sequential"
            else
            "Exhaustive image matching"
        ),
    )


    if matcher == "sequential":

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
            gpu,

        ])


    else:

        run([

            "colmap",
            "exhaustive_matcher",

            "--database_path",
            database,

            "--FeatureMatching.use_gpu",
            gpu,

        ])


    report(
        callback,
        25,
        "Solving camera positions",
    )


    run([

        "colmap",
        "mapper",

        "--database_path",
        database,

        "--image_path",
        image_dir,

        "--output_path",
        sparse,

    ])


    model = (
        sparse
        /
        "0"
    )


    if (
        not model.exists()
    ):

        return None


    return model


# =========================================================
# STABLE CAMERA SOLUTION
# =========================================================

def solve_cameras(
    image_dir,
    workspace,
    callback,
):

    input_count = len(
        get_images(
            image_dir
        )
    )


    if (
        input_count <
        20
    ):

        raise RuntimeError(
            "Too few photographs "
            "for reliable camera reconstruction."
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
            "===================================="
        )


        print(
            "COLMAP ATTEMPT",
            attempt_number
        )


        print(
            "Matcher:",
            matcher
        )


        if matcher == "sequential":

            print(
                "Overlap:",
                overlap
            )


        print(
            "===================================="
        )


        attempt_dir = (
            workspace
            /
            f"colmap_attempt_"
            f"{attempt_number}"
        )


        try:

            model = run_colmap_attempt(

                image_dir,
                attempt_dir,
                matcher,
                overlap,
                callback,

            )


        except Exception as error:

            print(
                "COLMAP attempt failed:"
            )


            print(
                error
            )


            continue


        if not model:

            continue


        text_dir = (
            attempt_dir
            /
            "model_text"
        )


        convert_to_text(

            model,
            text_dir,

        )


        names = read_registered_names(

            text_dir
            /
            "images.txt"

        )


        registered = len(
            names
        )


        ratio = (

            registered
            /
            input_count

        )


        print(
            "Registered:",
            registered,
            "/",
            input_count
        )


        print(
            "Registration ratio:",
            f"{ratio:.1%}"
        )


        if (
            registered >
            best_registered
        ):

            best_registered = (
                registered
            )

            best_model = (
                model
            )

            best_ratio = (
                ratio
            )


        if (
            ratio >=
            MIN_REGISTRATION_RATIO
        ):

            report(
                callback,
                35,
                (
                    f"Camera solution: "
                    f"{registered}/"
                    f"{input_count} "
                    f"images registered"
                ),
            )


            return (
                model,
                registered,
                input_count,
            )


    if (
        best_model is None
    ):

        raise RuntimeError(
            "COLMAP could not create "
            "a camera reconstruction."
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
            f"Required: "
            f"{MIN_REGISTRATION_RATIO:.0%}. "
            f"The scan needs better overlap "
            f"or coverage."

        )


    return (
        best_model,
        best_registered,
        input_count,
    )


# =========================================================
# UNDISTORT
# =========================================================

def undistort(
    image_dir,
    model,
    workspace,
    callback,
):

    root = (
        workspace
        /
        "undistorted"
    )


    report(
        callback,
        39,
        "Undistorting registered images",
    )


    run([

        "colmap",
        "image_undistorter",

        "--image_path",
        image_dir,

        "--input_path",
        model,

        "--output_path",
        root,

        "--output_type",
        "COLMAP",

        "--max_image_size",
        str(
            MAX_RECONSTRUCTION_IMAGE_SIZE
        ),

    ])


    image_path = (
        root
        /
        "images"
    )


    sparse_path = (
        root
        /
        "sparse"
    )


    if (
        not image_path.exists()
    ):

        raise RuntimeError(
            "COLMAP did not create "
            "undistorted images."
        )


    if (
        not sparse_path.exists()
    ):

        raise RuntimeError(
            "COLMAP did not create "
            "the undistorted sparse model."
        )


    return (
        image_path,
        sparse_path,
    )


# =========================================================
# QUATERNION
# =========================================================

def quaternion_to_rotation(
    qw,
    qx,
    qy,
    qz,
):

    return np.array(
        [
            [
                1 - 2 * (
                    qy * qy +
                    qz * qz
                ),

                2 * (
                    qx * qy -
                    qz * qw
                ),

                2 * (
                    qx * qz +
                    qy * qw
                ),
            ],

            [
                2 * (
                    qx * qy +
                    qz * qw
                ),

                1 - 2 * (
                    qx * qx +
                    qz * qz
                ),

                2 * (
                    qy * qz -
                    qx * qw
                ),
            ],

            [
                2 * (
                    qx * qz -
                    qy * qw
                ),

                2 * (
                    qy * qz +
                    qx * qw
                ),

                1 - 2 * (
                    qx * qx +
                    qy * qy
                ),
            ],
        ],
        dtype=np.float64,
    )


# =========================================================
# PARSE CAMERAS
# =========================================================

def parse_cameras(
    path,
):

    cameras = {}


    with open(
        path,
        "r",
        encoding="utf-8",
    ) as file:

        for line in file:

            line = line.strip()


            if (
                not line
                or
                line.startswith(
                    "#"
                )
            ):

                continue


            parts = line.split()


            camera_id = int(
                parts[0]
            )


            model = parts[1]


            width = int(
                parts[2]
            )


            height = int(
                parts[3]
            )


            parameters = [

                float(
                    value
                )

                for value
                in parts[4:]

            ]


            if model in (

                "SIMPLE_PINHOLE",
                "SIMPLE_RADIAL",
                "RADIAL",

            ):

                focal = parameters[0]

                fx = focal
                fy = focal

                cx = parameters[1]
                cy = parameters[2]


            elif model in (

                "PINHOLE",
                "OPENCV",
                "OPENCV_FISHEYE",
                "FULL_OPENCV",

            ):

                fx = parameters[0]
                fy = parameters[1]

                cx = parameters[2]
                cy = parameters[3]


            else:

                raise RuntimeError(
                    f"Unsupported COLMAP "
                    f"camera model: "
                    f"{model}"
                )


            cameras[
                camera_id
            ] = {

                "id":
                    camera_id,

                "model":
                    model,

                "width":
                    width,

                "height":
                    height,

                "fx":
                    fx,

                "fy":
                    fy,

                "cx":
                    cx,

                "cy":
                    cy,

            }


    return cameras


# =========================================================
# PARSE POINTS
# =========================================================

def parse_points3d(
    path,
):

    points = {}


    with open(
        path,
        "r",
        encoding="utf-8",
    ) as file:

        for line in file:

            line = line.strip()


            if (
                not line
                or
                line.startswith(
                    "#"
                )
            ):

                continue


            parts = line.split()


            if (
                len(
                    parts
                )
                <
                4
            ):

                continue


            point_id = int(
                parts[0]
            )


            points[
                point_id
            ] = np.array(
                [

                    float(
                        parts[1]
                    ),

                    float(
                        parts[2]
                    ),

                    float(
                        parts[3]
                    ),

                ],
                dtype=np.float64,
            )


    return points


# =========================================================
# PARSE IMAGES
# =========================================================

def parse_images(
    path,
):

    images = {}


    with open(
        path,
        "r",
        encoding="utf-8",
    ) as file:

        raw_lines = file.readlines()


    lines = [

        line.rstrip(
            "\n"
        )

        for line
        in raw_lines

        if not line.startswith(
            "#"
        )

    ]


    index = 0


    while (
        index <
        len(
            lines
        )
    ):

        header = (
            lines[
                index
            ]
            .strip()
        )


        index += 1


        if not header:

            continue


        parts = header.split()


        if (
            len(
                parts
            )
            <
            10
        ):

            continue


        try:

            image_id = int(
                parts[0]
            )

        except ValueError:

            continue


        qw = float(
            parts[1]
        )

        qx = float(
            parts[2]
        )

        qy = float(
            parts[3]
        )

        qz = float(
            parts[4]
        )


        tx = float(
            parts[5]
        )

        ty = float(
            parts[6]
        )

        tz = float(
            parts[7]
        )


        camera_id = int(
            parts[8]
        )


        name = " ".join(
            parts[
                9:
            ]
        )


        rotation = (
            quaternion_to_rotation(
                qw,
                qx,
                qy,
                qz,
            )
        )


        translation = np.array(
            [
                tx,
                ty,
                tz,
            ],
            dtype=np.float64,
        )


        observations = []


        if (
            index <
            len(
                lines
            )
        ):

            observation_line = (
                lines[
                    index
                ]
                .strip()
            )


            index += 1


            values = (
                observation_line.split()
            )


            for position in range(

                0,

                len(
                    values
                )
                -
                2,

                3,

            ):

                try:

                    x = float(
                        values[
                            position
                        ]
                    )


                    y = float(
                        values[
                            position + 1
                        ]
                    )


                    point_id = int(
                        values[
                            position + 2
                        ]
                    )


                except (
                    ValueError,
                    IndexError,
                ):

                    continue


                if point_id < 0:

                    continue


                observations.append(
                    (
                        x,
                        y,
                        point_id,
                    )
                )


        images[
            name
        ] = {

            "id":
                image_id,

            "camera_id":
                camera_id,

            "rotation":
                rotation,

            "translation":
                translation,

            "observations":
                observations,

        }


    return images


# =========================================================
# VIEW SELECTION
# =========================================================

def select_distributed_views(
    image_infos,
    image_dir,
):

    available = [

        name

        for name
        in sorted(
            image_infos.keys()
        )

        if (
            Path(
                image_dir
            )
            /
            name
        ).exists()

    ]


    if (
        len(
            available
        )
        <=
        MAX_DEPTH_VIEWS
    ):

        return available


    indices = np.linspace(

        0,

        len(
            available
        )
        -
        1,

        MAX_DEPTH_VIEWS,

        dtype=int,

    )


    selected = [

        available[
            index
        ]

        for index
        in indices

    ]


    return list(
        dict.fromkeys(
            selected
        )
    )


# =========================================================
# LOAD DEPTH MODEL
# =========================================================

def load_depth_model(
    callback,
):

    report(
        callback,
        46,
        "Loading neural depth model",
    )


    processor = (
        AutoImageProcessor
        .from_pretrained(
            DEPTH_MODEL_NAME
        )
    )


    model = (
        AutoModelForDepthEstimation
        .from_pretrained(
            DEPTH_MODEL_NAME
        )
    )


    model.eval()


    model = model.to(
        DEVICE
    )


    return (
        processor,
        model,
    )


# =========================================================
# DEPTH PREDICTION
# =========================================================

@torch.inference_mode()
def predict_depth(
    image,
    processor,
    model,
):

    inputs = processor(

        images=
            image,

        return_tensors=
            "pt",

    )


    converted = {}


    for (
        key,
        value,
    ) in inputs.items():

        if torch.is_tensor(
            value
        ):

            converted[
                key
            ] = value.to(
                DEVICE
            )

        else:

            converted[
                key
            ] = value


    output = model(
        **converted
    )


    depth = (
        output
        .predicted_depth
    )


    depth = (
        torch.nn.functional
        .interpolate(

            depth.unsqueeze(
                1
            ),

            size=(

                image.height,
                image.width,

            ),

            mode=
                "bicubic",

            align_corners=
                False,

        )
        .squeeze(
            1
        )
        .squeeze(
            0
        )
    )


    return (

        depth
        .float()
        .cpu()
        .numpy()

    )


# =========================================================
# ROBUST LINEAR FIT
# =========================================================

def robust_linear_fit(
    x,
    y,
):

    x = np.asarray(
        x,
        dtype=np.float64,
    )


    y = np.asarray(
        y,
        dtype=np.float64,
    )


    valid = (

        np.isfinite(
            x
        )

        &

        np.isfinite(
            y
        )

        &

        (
            y >
            0
        )

    )


    x = x[
        valid
    ]


    y = y[
        valid
    ]


    if (
        len(
            x
        )
        <
        MIN_SPARSE_ALIGNMENT_POINTS
    ):

        return None


    mask = np.ones(
        len(
            x
        ),
        dtype=bool,
    )


    coefficients = None


    for _ in range(
        6
    ):

        if (
            mask.sum()
            <
            MIN_SPARSE_ALIGNMENT_POINTS
        ):

            return None


        design = np.column_stack(
            [
                x[
                    mask
                ],

                np.ones(
                    mask.sum()
                ),
            ]
        )


        coefficients = (
            np.linalg
            .lstsq(

                design,

                y[
                    mask
                ],

                rcond=None,

            )[0]
        )


        prediction = (
            coefficients[0]
            *
            x
            +
            coefficients[1]
        )


        residual = np.abs(
            prediction
            -
            y
        )


        active = residual[
            mask
        ]


        median = np.median(
            active
        )


        mad = np.median(
            np.abs(
                active
                -
                median
            )
        )


        threshold = max(

            median
            +
            3.5
            *
            max(
                mad,
                1e-8,
            ),

            1e-6,

        )


        new_mask = (
            residual
            <=
            threshold
        )


        if (
            np.array_equal(
                new_mask,
                mask,
            )
        ):

            break


        mask = new_mask


    if (
        coefficients is None
    ):

        return None


    prediction = (
        coefficients[0]
        *
        x[
            mask
        ]
        +
        coefficients[1]
    )


    relative_error = np.median(

        np.abs(

            prediction

            -

            y[
                mask
            ]

        )

        /

        np.maximum(

            np.abs(
                y[
                    mask
                ]
            ),

            1e-6,

        )

    )


    return {

        "a":
            float(
                coefficients[0]
            ),

        "b":
            float(
                coefficients[1]
            ),

        "error":
            float(
                relative_error
            ),

        "count":
            int(
                mask.sum()
            ),

    }


# =========================================================
# ALIGN DEPTH WITH COLMAP
# =========================================================

def align_depth_to_sparse(
    depth,
    image_info,
    camera,
    points3d,
):

    predicted_values = []

    true_depth_values = []


    height, width = (
        depth.shape
    )


    scale_x = (
        width
        /
        camera[
            "width"
        ]
    )


    scale_y = (
        height
        /
        camera[
            "height"
        ]
    )


    rotation = (
        image_info[
            "rotation"
        ]
    )


    translation = (
        image_info[
            "translation"
        ]
    )


    for (
        x,
        y,
        point_id,
    ) in image_info[
        "observations"
    ]:

        world_point = (
            points3d.get(
                point_id
            )
        )


        if (
            world_point
            is None
        ):

            continue


        camera_point = (

            rotation
            @
            world_point

            +

            translation

        )


        true_depth = float(
            camera_point[
                2
            ]
        )


        if (
            true_depth <=
            0
        ):

            continue


        px = int(
            round(
                x
                *
                scale_x
            )
        )


        py = int(
            round(
                y
                *
                scale_y
            )
        )


        if (

            px <
            0

            or

            py <
            0

            or

            px >=
            width

            or

            py >=
            height

        ):

            continue


        predicted = float(
            depth[
                py,
                px
            ]
        )


        if (
            not math.isfinite(
                predicted
            )
        ):

            continue


        predicted_values.append(
            predicted
        )


        true_depth_values.append(
            true_depth
        )


    if (
        len(
            predicted_values
        )
        <
        MIN_SPARSE_ALIGNMENT_POINTS
    ):

        return None


    predicted_values = np.asarray(
        predicted_values,
        dtype=np.float64,
    )


    true_depth_values = np.asarray(
        true_depth_values,
        dtype=np.float64,
    )


    direct_fit = robust_linear_fit(

        predicted_values,
        true_depth_values,

    )


    inverse_values = (

        1.0

        /

        np.maximum(
            predicted_values,
            1e-8,
        )

    )


    inverse_fit = robust_linear_fit(

        inverse_values,
        true_depth_values,

    )


    candidates = []


    if direct_fit:

        candidates.append(
            (
                direct_fit[
                    "error"
                ],

                "direct",

                direct_fit,
            )
        )


    if inverse_fit:

        candidates.append(
            (
                inverse_fit[
                    "error"
                ],

                "inverse",

                inverse_fit,
            )
        )


    if not candidates:

        return None


    candidates.sort(
        key=lambda item:
            item[0]
    )


    (
        _,
        mode,
        fit,
    ) = candidates[0]


    if mode == "direct":

        metric = (

            fit[
                "a"
            ]
            *
            depth

            +

            fit[
                "b"
            ]

        )


    else:

        metric = (

            fit[
                "a"
            ]

            *

            (
                1.0

                /

                np.maximum(
                    depth,
                    1e-8,
                )
            )

            +

            fit[
                "b"
            ]

        )


    metric = metric.astype(
        np.float32
    )


    metric[
        ~np.isfinite(
            metric
        )
    ] = 0


    metric[
        metric <=
        0
    ] = 0


    return metric


# =========================================================
# BACKPROJECT
# =========================================================

def depth_to_world_points(
    depth,
    image,
    image_info,
    camera,
):

    height, width = (
        depth.shape
    )


    sx = (
        width
        /
        camera[
            "width"
        ]
    )


    sy = (
        height
        /
        camera[
            "height"
        ]
    )


    fx = (
        camera[
            "fx"
        ]
        *
        sx
    )


    fy = (
        camera[
            "fy"
        ]
        *
        sy
    )


    cx = (
        camera[
            "cx"
        ]
        *
        sx
    )


    cy = (
        camera[
            "cy"
        ]
        *
        sy
    )


    valid_depth = depth[
        depth >
        0
    ]


    if (
        valid_depth.size ==
        0
    ):

        return (
            np.empty(
                (
                    0,
                    3,
                )
            ),

            np.empty(
                (
                    0,
                    3,
                )
            ),
        )


    near = np.percentile(
        valid_depth,
        5
    )


    far = np.percentile(
        valid_depth,
        95
    )


    ys = np.arange(
        0,
        height,
        POINT_STRIDE,
    )


    xs = np.arange(
        0,
        width,
        POINT_STRIDE,
    )


    grid_x, grid_y = np.meshgrid(
        xs,
        ys,
    )


    z = depth[
        grid_y,
        grid_x
    ]


    valid = (

        np.isfinite(
            z
        )

        &

        (
            z >
            near
        )

        &

        (
            z <
            far
        )

    )


    u = grid_x[
        valid
    ].astype(
        np.float64
    )


    v = grid_y[
        valid
    ].astype(
        np.float64
    )


    z = z[
        valid
    ].astype(
        np.float64
    )


    x = (
        (
            u -
            cx
        )
        /
        fx
        *
        z
    )


    y = (
        (
            v -
            cy
        )
        /
        fy
        *
        z
    )


    camera_points = np.column_stack(
        [
            x,
            y,
            z,
        ]
    )


    rotation = (
        image_info[
            "rotation"
        ]
    )


    translation = (
        image_info[
            "translation"
        ]
    )


    world_points = (

        rotation.T

        @

        (
            camera_points
            -
            translation
        ).T

    ).T


    rgb = (

        np.asarray(
            image.convert(
                "RGB"
            ),
            dtype=np.float32,
        )

        /

        255.0

    )


    colors = rgb[
        grid_y[
            valid
        ],
        grid_x[
            valid
        ],
    ]


    return (
        world_points,
        colors,
    )


# =========================================================
# BUILD MULTI-VIEW CLOUD
# =========================================================

def build_point_cloud(
    image_dir,
    cameras,
    image_infos,
    points3d,
    processor,
    model,
    callback,
):

    selected = select_distributed_views(

        image_infos,
        image_dir,

    )


    print(
        "Registered views available:",
        len(
            image_infos
        )
    )


    print(
        "Neural depth views selected:",
        len(
            selected
        )
    )


    all_points = []

    all_colors = []


    valid_views = 0


    for (
        index,
        name,
    ) in enumerate(
        selected,
        start=1,
    ):

        progress = (

            50

            +

            (
                29
                *
                index
                /
                max(
                    len(
                        selected
                    ),
                    1,
                )
            )

        )


        report(

            callback,

            int(
                progress
            ),

            (
                f"Neural depth "
                f"{index}/"
                f"{len(selected)}"
            ),

        )


        image_path = (
            image_dir
            /
            name
        )


        try:

            image = (
                Image
                .open(
                    image_path
                )
                .convert(
                    "RGB"
                )
            )


            info = (
                image_infos[
                    name
                ]
            )


            camera = (
                cameras[
                    info[
                        "camera_id"
                    ]
                ]
            )


            relative_depth = predict_depth(

                image,
                processor,
                model,

            )


            metric_depth = align_depth_to_sparse(

                relative_depth,
                info,
                camera,
                points3d,

            )


            if (
                metric_depth
                is None
            ):

                print(
                    "Skipping:",
                    name,
                    "— insufficient sparse alignment."
                )

                continue


            (
                points,
                colors,
            ) = depth_to_world_points(

                metric_depth,
                image,
                info,
                camera,

            )


            if (
                len(
                    points
                )
                <
                100
            ):

                print(
                    "Skipping:",
                    name,
                    "— insufficient depth points."
                )

                continue


            all_points.append(
                points
            )


            all_colors.append(
                colors
            )


            valid_views += 1


        except Exception as error:

            print(
                "Depth view failed:",
                name
            )


            print(
                error
            )


        if (
            DEVICE.type ==
            "mps"
        ):

            try:

                torch.mps.empty_cache()

            except Exception:

                pass


    minimum_valid = max(

        20,

        int(
            len(
                selected
            )
            *
            0.45
        ),

    )


    if (
        valid_views <
        minimum_valid
    ):

        raise RuntimeError(

            f"Too few views produced usable "
            f"depth geometry. "
            f"{valid_views}/"
            f"{len(selected)} valid. "
            f"Required at least "
            f"{minimum_valid}."

        )


    points = np.concatenate(
        all_points,
        axis=0,
    )


    colors = np.concatenate(
        all_colors,
        axis=0,
    )


    cloud = (
        o3d.geometry
        .PointCloud()
    )


    cloud.points = (
        o3d.utility
        .Vector3dVector(
            points
        )
    )


    cloud.colors = (
        o3d.utility
        .Vector3dVector(
            colors
        )
    )


    print(
        "Valid neural views:",
        valid_views
    )


    print(
        "Raw fused points:",
        len(
            cloud.points
        )
    )


    return cloud


# =========================================================
# CLEAN POINT CLOUD
# =========================================================

def clean_point_cloud(
    cloud,
    callback,
):

    report(
        callback,
        82,
        "Cleaning fused point cloud",
    )


    bbox = (
        cloud
        .get_axis_aligned_bounding_box()
    )


    diagonal = float(
        np.linalg.norm(
            bbox.get_extent()
        )
    )


    if (
        not np.isfinite(
            diagonal
        )
        or
        diagonal <=
        0
    ):

        raise RuntimeError(
            "Point cloud has invalid scale."
        )


    voxel_size = max(

        diagonal
        *
        VOXEL_SIZE_RATIO,

        1e-6,

    )


    cloud = (
        cloud
        .voxel_down_sample(
            voxel_size
        )
    )


    print(
        "After voxel downsample:",
        len(
            cloud.points
        )
    )


    if (
        len(
            cloud.points
        )
        >
        500
    ):

        cloud, _ = (
            cloud
            .remove_statistical_outlier(

                nb_neighbors=
                    24,

                std_ratio=
                    1.8,

            )
        )


    if (
        len(
            cloud.points
        )
        <
        500
    ):

        raise RuntimeError(
            "Point-cloud cleanup left "
            "too little geometry."
        )


    cloud.estimate_normals(

        search_param=
            o3d.geometry
            .KDTreeSearchParamHybrid(

                radius=
                    voxel_size
                    *
                    8,

                max_nn=
                    50,

            )

    )


    try:

        cloud.orient_normals_consistent_tangent_plane(
            20
        )

    except Exception as error:

        print(
            "Normal orientation warning:",
            error
        )


    return (
        cloud,
        voxel_size,
    )


# =========================================================
# GENERATE MESH
# =========================================================

def point_cloud_to_mesh(
    cloud,
    output_path,
    callback,
):

    report(
        callback,
        90,
        "Generating ear surface mesh",
    )


    (
        mesh,
        densities,
    ) = (
        o3d.geometry
        .TriangleMesh
        .create_from_point_cloud_poisson(

            cloud,

            depth=
                MESH_POISSON_DEPTH,

        )
    )


    densities = np.asarray(
        densities
    )


    if (
        densities.size >
        0
    ):

        threshold = np.quantile(

            densities,

            MESH_DENSITY_QUANTILE,

        )


        mesh.remove_vertices_by_mask(

            densities
            <
            threshold

        )


    # Restrict Poisson surface to observed region.

    bbox = (
        cloud
        .get_axis_aligned_bounding_box()
    )


    bbox = bbox.scale(

        1.04,

        bbox.get_center(),

    )


    mesh = mesh.crop(
        bbox
    )


    mesh.remove_degenerate_triangles()

    mesh.remove_duplicated_triangles()

    mesh.remove_duplicated_vertices()

    mesh.remove_non_manifold_edges()

    mesh.compute_vertex_normals()


    if (
        len(
            mesh.vertices
        )
        <
        100
    ):

        raise RuntimeError(
            "Generated mesh contains "
            "too few vertices."
        )


    success = (
        o3d.io
        .write_triangle_mesh(

            str(
                output_path
            ),

            mesh,

            write_ascii=
                False,

        )
    )


    if (
        not success
        or
        not output_path.exists()
    ):

        raise RuntimeError(
            "Open3D could not save "
            "the reconstructed mesh."
        )


    report(
        callback,
        100,
        "Raw ear mesh complete",
    )


    return output_path


# =========================================================
# MAIN
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
            f"{len(images)} photographs "
            f"were found."

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
        "============================================"
    )


    print(
        "HAMMER CRAFT RECONSTRUCTION V2"
    )


    print(
        "Images:",
        len(
            images
        )
    )


    print(
        "Operating system:",
        platform.system()
    )


    print(
        "Architecture:",
        platform.machine()
    )


    print(
        "PyTorch:",
        torch.__version__
    )


    print(
        "Accelerator:",
        accelerator_name()
    )


    print(
        "Depth model:",
        DEPTH_MODEL_NAME
    )


    print(
        "============================================"
        "\n"
    )


    # -----------------------------------------------------
    # CAMERA RECONSTRUCTION
    # -----------------------------------------------------

    (
        sparse_model,
        registered_count,
        original_count,
    ) = solve_cameras(

        image_dir,
        workspace,
        progress_callback,

    )


    print(
        "Camera registration:",
        registered_count,
        "/",
        original_count
    )


    # -----------------------------------------------------
    # UNDISTORT
    # -----------------------------------------------------

    (
        undistorted_images,
        undistorted_sparse,
    ) = undistort(

        image_dir,
        sparse_model,
        workspace,
        progress_callback,

    )


    # -----------------------------------------------------
    # MODEL TO TEXT
    # -----------------------------------------------------

    text_model = convert_to_text(

        undistorted_sparse,

        workspace
        /
        "undistorted_model_text",

    )


    cameras = parse_cameras(

        text_model
        /
        "cameras.txt"

    )


    image_infos = parse_images(

        text_model
        /
        "images.txt"

    )


    points3d = parse_points3d(

        text_model
        /
        "points3D.txt"

    )


    if not image_infos:

        raise RuntimeError(
            "COLMAP produced no registered images."
        )


    if not points3d:

        raise RuntimeError(
            "COLMAP produced no sparse geometry."
        )


    # -----------------------------------------------------
    # NEURAL DEPTH MODEL
    # -----------------------------------------------------

    (
        processor,
        model,
    ) = load_depth_model(
        progress_callback
    )


    # -----------------------------------------------------
    # DEPTH FUSION
    # -----------------------------------------------------

    cloud = build_point_cloud(

        undistorted_images,

        cameras,

        image_infos,

        points3d,

        processor,

        model,

        progress_callback,

    )


    # -----------------------------------------------------
    # RELEASE GPU/MPS MEMORY
    # -----------------------------------------------------

    del model

    del processor


    if DEVICE.type == "cuda":

        torch.cuda.empty_cache()


    elif DEVICE.type == "mps":

        try:

            torch.mps.empty_cache()

        except Exception:

            pass


    # -----------------------------------------------------
    # POINT CLOUD CLEANUP
    # -----------------------------------------------------

    (
        cloud,
        _
    ) = clean_point_cloud(

        cloud,
        progress_callback,

    )


    fused_path = (
        workspace
        /
        "fused-neural.ply"
    )


    o3d.io.write_point_cloud(

        str(
            fused_path
        ),

        cloud,

    )


    # -----------------------------------------------------
    # SURFACE
    # -----------------------------------------------------

    raw_mesh = (
        workspace
        /
        "raw-mesh.ply"
    )


    return point_cloud_to_mesh(

        cloud,
        raw_mesh,
        progress_callback,

    )