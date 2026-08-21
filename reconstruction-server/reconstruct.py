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
# CONFIG
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
                "CUDA - "
                +
                torch.cuda.get_device_name(
                    0
                )
            )

        except Exception:

            return "CUDA"


    if DEVICE.type == "mps":

        return "MPS / Apple Metal"


    return "CPU"


# =========================================================
# PROGRESS
# =========================================================

def report(
    callback,
    percent,
    message,
):

    accelerator = accelerator_name()


    print(

        f"[RECONSTRUCTION "
        f"{percent}%] "
        f"{message} "
        f"[{accelerator}]",

        flush=True,

    )


    if callback:

        try:

            callback(
                percent,
                message,
                accelerator,
            )

        except TypeError:

            callback(
                percent,
                message,
            )


# =========================================================
# COMMAND
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


    return_code = process.wait()


    if return_code != 0:

        text = "".join(
            output
        )


        raise RuntimeError(

            f"External command failed "
            f"with code {return_code}\n\n"

            f"{' '.join(command)}\n\n"

            f"{text[-12000:]}"

        )


# =========================================================
# IMAGES
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
# COLMAP GPU
# =========================================================

def use_colmap_cuda():

    return (
        DEVICE.type ==
        "cuda"
    )


# =========================================================
# CONVERT COLMAP MODEL
# =========================================================

def convert_model_to_text(
    model_path,
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
        model_path,

        "--output_path",
        destination,

        "--output_type",
        "TXT",

    ])


    return destination


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


            params = [
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

                fx = params[0]
                fy = params[0]

                cx = params[1]
                cy = params[2]


            elif model in (

                "PINHOLE",
                "OPENCV",
                "OPENCV_FISHEYE",
                "FULL_OPENCV",

            ):

                fx = params[0]
                fy = params[1]

                cx = params[2]
                cy = params[3]


            else:

                raise RuntimeError(
                    f"Unsupported camera model: "
                    f"{model}"
                )


            cameras[
                camera_id
            ] = {

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


            if len(
                parts
            ) < 4:

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

        iterator = iter(
            file
        )


        for line in iterator:

            if line.startswith(
                "#"
            ):

                continue


            header = line.strip()


            if not header:

                continue


            parts = header.split()


            if len(
                parts
            ) < 10:

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
                parts[9:]
            )


            try:

                observation_line = next(
                    iterator
                ).strip()

            except StopIteration:

                observation_line = ""


            observations = []


            values = (
                observation_line.split()
                if observation_line
                else []
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


            rotation = quaternion_to_rotation(

                qw,
                qx,
                qy,
                qz,

            )


            translation = np.array(

                [
                    tx,
                    ty,
                    tz,
                ],

                dtype=np.float64,

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
# COLMAP ATTEMPT
# =========================================================

def run_colmap_attempt(
    image_dir,
    attempt_dir,
    matcher,
    overlap,
    callback,
):

    attempt_dir.mkdir(
        parents=True,
        exist_ok=True,
    )


    database = (
        attempt_dir
        /
        "database.db"
    )


    sparse = (
        attempt_dir
        /
        "sparse"
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
        if use_colmap_cuda()
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
        15,
        "Matching photographs",
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


    if not model.exists():

        return None


    return model


# =========================================================
# CAMERA SOLUTION WITH RETRIES
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


    best = None


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
            "\nCOLMAP ATTEMPT",
            attempt_number,
            matcher,
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


        if model is None:

            continue


        text_model = convert_model_to_text(

            model,

            attempt_dir
            /
            "text_model",

        )


        infos = parse_images(

            text_model
            /
            "images.txt"

        )


        registered = len(
            infos
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
            "Registered:",
            registered,
            "/",
            input_count,
            f"({ratio:.1%})"
        )


        if (
            best is None
            or
            registered >
            best[
                1
            ]
        ):

            best = (
                model,
                registered,
                ratio,
            )


        if (
            ratio >=
            MIN_REGISTRATION_RATIO
        ):

            return (
                model,
                registered,
                input_count,
            )


    if best is None:

        raise RuntimeError(
            "COLMAP could not create "
            "a camera solution."
        )


    (
        model,
        registered,
        ratio,
    ) = best


    if (
        ratio <
        MIN_REGISTRATION_RATIO
    ):

        raise RuntimeError(

            f"Camera registration too low. "
            f"{registered}/{input_count} "
            f"images registered "
            f"({ratio:.0%}). "

            f"Required at least "
            f"{MIN_REGISTRATION_RATIO:.0%}."

        )


    return (
        model,
        registered,
        input_count,
    )


# =========================================================
# UNDISTORT
# =========================================================

def undistort(
    image_dir,
    sparse_model,
    workspace,
    callback,
):

    output = (
        workspace
        /
        "undistorted"
    )


    if output.exists():

        shutil.rmtree(
            output
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
        sparse_model,

        "--output_path",
        output,

        "--output_type",
        "COLMAP",

        "--max_image_size",
        str(
            MAX_RECONSTRUCTION_IMAGE_SIZE
        ),

    ])


    images = (
        output
        /
        "images"
    )


    sparse = (
        output
        /
        "sparse"
    )


    if not images.exists():

        raise RuntimeError(
            "Undistorted images missing."
        )


    if not sparse.exists():

        raise RuntimeError(
            "Undistorted sparse model missing."
        )


    return (
        images,
        sparse,
    )


# =========================================================
# SELECT DEPTH VIEWS
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


    return [

        available[
            index
        ]

        for index
        in indices

    ]


# =========================================================
# DEPTH MODEL
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
# PREDICT DEPTH
# =========================================================

@torch.inference_mode()
def predict_depth(
    image,
    processor,
    model,
):

    inputs = processor(

        images=image,

        return_tensors=
            "pt",

    )


    model_inputs = {}


    for (
        key,
        value,
    ) in inputs.items():

        if torch.is_tensor(
            value
        ):

            model_inputs[
                key
            ] = value.to(
                DEVICE
            )

        else:

            model_inputs[
                key
            ] = value


    result = model(
        **model_inputs
    )


    depth = (
        result
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
# ROBUST SCALE FIT
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
        5
    ):

        if (
            mask.sum()
            <
            MIN_SPARSE_ALIGNMENT_POINTS
        ):

            return None


        matrix = np.column_stack(
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

                matrix,

                y[
                    mask
                ],

                rcond=None,

            )[0]
        )


        predicted = (

            coefficients[0]
            *
            x

            +

            coefficients[1]

        )


        residual = np.abs(
            predicted
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
            residual <=
            threshold
        )


        if np.array_equal(
            mask,
            new_mask,
        ):

            break


        mask = new_mask


    if coefficients is None:

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


    error = np.median(

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
                error
            ),

    }


# =========================================================
# ALIGN NEURAL DEPTH
# =========================================================

def align_depth_to_sparse(
    depth,
    image_info,
    camera,
    points3d,
):

    neural_values = []

    colmap_values = []


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

        world_point = points3d.get(
            point_id
        )


        if world_point is None:

            continue


        camera_point = (

            rotation
            @
            world_point

            +

            translation

        )


        real_depth = float(
            camera_point[
                2
            ]
        )


        if real_depth <= 0:

            continue


        px = int(
            round(
                x *
                sx
            )
        )


        py = int(
            round(
                y *
                sy
            )
        )


        if (

            px < 0
            or
            py < 0
            or
            px >= width
            or
            py >= height

        ):

            continue


        predicted = float(
            depth[
                py,
                px
            ]
        )


        if not math.isfinite(
            predicted
        ):

            continue


        neural_values.append(
            predicted
        )


        colmap_values.append(
            real_depth
        )


    if (
        len(
            neural_values
        )
        <
        MIN_SPARSE_ALIGNMENT_POINTS
    ):

        return None


    neural_values = np.asarray(
        neural_values,
        dtype=np.float64,
    )


    colmap_values = np.asarray(
        colmap_values,
        dtype=np.float64,
    )


    direct = robust_linear_fit(

        neural_values,

        colmap_values,

    )


    inverse_input = (

        1.0

        /

        np.maximum(
            neural_values,
            1e-8,
        )

    )


    inverse = robust_linear_fit(

        inverse_input,

        colmap_values,

    )


    candidates = []


    if direct:

        candidates.append(
            (
                direct[
                    "error"
                ],
                "direct",
                direct,
            )
        )


    if inverse:

        candidates.append(
            (
                inverse[
                    "error"
                ],
                "inverse",
                inverse,
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
# DEPTH TO WORLD
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
        width /
        camera[
            "width"
        ]
    )


    sy = (
        height /
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


    if valid_depth.size == 0:

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
# MULTIVIEW CLOUD
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
        "Neural depth views:",
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

        progress = int(

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

            progress,

            (
                f"Neural depth "
                f"{index}/"
                f"{len(selected)}"
            ),

        )


        image_path = (
            Path(
                image_dir
            )
            /
            name
        )


        try:

            with Image.open(
                image_path
            ) as source:

                image = source.convert(
                    "RGB"
                )


            info = image_infos[
                name
            ]


            camera = cameras[
                info[
                    "camera_id"
                ]
            ]


            neural_depth = predict_depth(

                image,

                processor,

                model,

            )


            metric_depth = align_depth_to_sparse(

                neural_depth,

                info,

                camera,

                points3d,

            )


            if metric_depth is None:

                print(
                    "Skipping",
                    name,
                    "- insufficient sparse alignment."
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


            if len(
                points
            ) < 100:

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


        if DEVICE.type == "mps":

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
            0.40
        ),

    )


    if (
        valid_views <
        minimum_valid
    ):

        raise RuntimeError(

            f"Too few usable depth views. "
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


    cloud = o3d.geometry.PointCloud()


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
        "Valid depth views:",
        valid_views
    )


    print(
        "Raw points:",
        len(
            cloud.points
        )
    )


    return cloud


# =========================================================
# CLEAN CLOUD
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
        diagonal <= 0
    ):

        raise RuntimeError(
            "Invalid point-cloud size."
        )


    voxel_size = max(

        diagonal
        *
        VOXEL_SIZE_RATIO,

        1e-6,

    )


    cloud = cloud.voxel_down_sample(
        voxel_size
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
            "Too few points remain "
            "after cleanup."
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


    return cloud


# =========================================================
# MESH
# =========================================================

def point_cloud_to_mesh(
    cloud,
    output_path,
    callback,
):

    report(
        callback,
        90,
        "Generating surface mesh",
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


    if densities.size:

        threshold = np.quantile(

            densities,

            MESH_DENSITY_QUANTILE,

        )


        mesh.remove_vertices_by_mask(
            densities <
            threshold
        )


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
            "Generated mesh is too small."
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
            "Unable to save raw mesh."
        )


    report(
        callback,
        100,
        "Raw mesh complete",
    )


    return output_path


# =========================================================
# MAIN RECONSTRUCTION
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
            f"{len(images)} "
            f"images found."

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
        "HAMMER CRAFT RECONSTRUCTION"
    )


    print(
        "Images:",
        len(
            images
        )
    )


    print(
        "OS:",
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
        "============================================"
    )


    (
        sparse_model,
        registered,
        total,
    ) = solve_cameras(

        image_dir,
        workspace,
        progress_callback,

    )


    print(
        "Registered cameras:",
        registered,
        "/",
        total
    )


    (
        undistorted_images,
        undistorted_sparse,
    ) = undistort(

        image_dir,
        sparse_model,
        workspace,
        progress_callback,

    )


    text_model = convert_model_to_text(

        undistorted_sparse,

        workspace
        /
        "undistorted_text",

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


    if not cameras:

        raise RuntimeError(
            "No COLMAP cameras found."
        )


    if not image_infos:

        raise RuntimeError(
            "No registered images found."
        )


    if not points3d:

        raise RuntimeError(
            "No sparse 3D points found."
        )


    (
        processor,
        model,
    ) = load_depth_model(
        progress_callback
    )


    cloud = build_point_cloud(

        undistorted_images,

        cameras,

        image_infos,

        points3d,

        processor,

        model,

        progress_callback,

    )


    del model

    del processor


    if DEVICE.type == "cuda":

        torch.cuda.empty_cache()


    elif DEVICE.type == "mps":

        try:

            torch.mps.empty_cache()

        except Exception:

            pass


    cloud = clean_point_cloud(

        cloud,

        progress_callback,

    )


    fused_cloud_path = (

        workspace
        /
        "fused-neural.ply"

    )


    o3d.io.write_point_cloud(

        str(
            fused_cloud_path
        ),

        cloud,

    )


    raw_mesh_path = (

        workspace
        /
        "raw-mesh.ply"

    )


    return point_cloud_to_mesh(

        cloud,

        raw_mesh_path,

        progress_callback,

    )