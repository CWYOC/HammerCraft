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
# SETTINGS
# =========================================================

DEPTH_MODEL_NAME = os.getenv(
    "DEPTH_MODEL",
    "depth-anything/Depth-Anything-V2-Small-hf",
)


POINT_STRIDE = int(
    os.getenv(
        "POINT_STRIDE",
        "5",
    )
)


MAX_RECONSTRUCTION_IMAGE_SIZE = int(
    os.getenv(
        "MAX_RECONSTRUCTION_IMAGE_SIZE",
        "1800",
    )
)


VOXEL_SIZE_RATIO = float(
    os.getenv(
        "VOXEL_SIZE_RATIO",
        "0.0025",
    )
)


MIN_SPARSE_ALIGNMENT_POINTS = int(
    os.getenv(
        "MIN_SPARSE_ALIGNMENT_POINTS",
        "8",
    )
)


# =========================================================
# DEVICE
# =========================================================

def select_device():

    if (
        torch.cuda.is_available()
    ):

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

    if (
        DEVICE.type ==
        "cuda"
    ):

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


    if (
        DEVICE.type ==
        "mps"
    ):

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
    stage,
):

    accelerator = (
        accelerator_name()
    )


    print(
        f"[RECONSTRUCTION "
        f"{percent}%] "
        f"{stage} "
        f"[{accelerator}]",
        flush=True,
    )


    if (
        callback
    ):

        try:

            callback(
                percent,
                stage,
                accelerator,
            )

        except TypeError:

            callback(
                percent,
                stage,
            )


# =========================================================
# COMMAND RUNNER
# =========================================================

def run(
    command,
    cwd=None,
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

        cwd=(
            str(
                cwd
            )
            if cwd
            else None
        ),

        stdout=
            subprocess.PIPE,

        stderr=
            subprocess.STDOUT,

        text=
            True,

        bufsize=
            1,

    )


    lines = []


    if (
        process.stdout
        is not None
    ):

        for line in process.stdout:

            print(
                line,
                end="",
                flush=True,
            )

            lines.append(
                line
            )


    return_code = (
        process.wait()
    )


    if (
        return_code != 0
    ):

        text = "".join(
            lines
        )


        raise RuntimeError(

            f"External command failed "
            f"with exit code "
            f"{return_code}\n\n"

            f"COMMAND:\n"
            f"{' '.join(command)}\n\n"

            f"OUTPUT:\n"
            f"{text[-12000:]}"

        )


# =========================================================
# IMAGE COUNT
# =========================================================

def get_images(
    image_dir,
):

    extensions = (
        "*.jpg",
        "*.jpeg",
        "*.JPG",
        "*.JPEG",
        "*.png",
        "*.PNG",
    )


    files = []


    for extension in extensions:

        files.extend(
            image_dir.glob(
                extension
            )
        )


    return sorted(
        list(
            set(
                files
            )
        )
    )


# =========================================================
# COLMAP FEATURE GPU
# =========================================================

def colmap_feature_gpu():

    # COLMAP can use CUDA SIFT on
    # NVIDIA machines.
    #
    # MPS is not a COLMAP CUDA device,
    # so Apple Silicon uses CPU for
    # COLMAP feature extraction.

    return (
        DEVICE.type ==
        "cuda"
    )


# =========================================================
# COLMAP CAMERA POSES
# =========================================================

def run_colmap(
    image_dir,
    workspace,
    callback,
):

    database_path = (
        workspace /
        "database.db"
    )


    sparse_dir = (
        workspace /
        "sparse"
    )


    sparse_dir.mkdir(
        parents=True,
        exist_ok=True,
    )


    gpu_value = (
        "1"
        if colmap_feature_gpu()
        else "0"
    )


    # -----------------------------------------------------
    # FEATURE EXTRACTION
    # -----------------------------------------------------

    report(
        callback,
        5,
        "Extracting image features",
    )


    run([
        "colmap",
        "feature_extractor",

        "--database_path",
        database_path,

        "--image_path",
        image_dir,

        "--ImageReader.single_camera",
        "1",

        "--FeatureExtraction.use_gpu",
        gpu_value,
    ])


    # -----------------------------------------------------
    # SEQUENTIAL MATCHING
    # -----------------------------------------------------

    report(
        callback,
        15,
        "Matching overlapping photographs",
    )


    run([
        "colmap",
        "sequential_matcher",

        "--database_path",
        database_path,

        "--SequentialMatching.overlap",
        "10",

        "--FeatureMatching.use_gpu",
        gpu_value,
    ])


    # -----------------------------------------------------
    # MAPPER
    # -----------------------------------------------------

    report(
        callback,
        28,
        "Solving camera positions",
    )


    run([
        "colmap",
        "mapper",

        "--database_path",
        database_path,

        "--image_path",
        image_dir,

        "--output_path",
        sparse_dir,
    ])


    sparse_model = (
        sparse_dir /
        "0"
    )


    if (
        not sparse_model.exists()
    ):

        raise RuntimeError(
            "COLMAP could not produce "
            "a sparse reconstruction."
        )


    report(
        callback,
        38,
        "Camera reconstruction complete",
    )


    return sparse_model


# =========================================================
# UNDISTORT IMAGES
# =========================================================

def undistort_images(
    image_dir,
    sparse_model,
    workspace,
    callback,
):

    dense_root = (
        workspace /
        "undistorted"
    )


    report(
        callback,
        42,
        "Undistorting camera images",
    )


    run([
        "colmap",
        "image_undistorter",

        "--image_path",
        image_dir,

        "--input_path",
        sparse_model,

        "--output_path",
        dense_root,

        "--output_type",
        "COLMAP",

        "--max_image_size",
        str(
            MAX_RECONSTRUCTION_IMAGE_SIZE
        ),
    ])


    undistorted_images = (
        dense_root /
        "images"
    )


    undistorted_sparse = (
        dense_root /
        "sparse"
    )


    if (
        not undistorted_images.exists()
    ):

        raise RuntimeError(
            "COLMAP did not create "
            "undistorted images."
        )


    if (
        not undistorted_sparse.exists()
    ):

        raise RuntimeError(
            "COLMAP did not create "
            "the undistorted sparse model."
        )


    return (
        dense_root,
        undistorted_images,
        undistorted_sparse,
    )


# =========================================================
# CONVERT MODEL TO TEXT
# =========================================================

def convert_model_to_text(
    sparse_model,
    workspace,
):

    txt_dir = (
        workspace /
        "model_txt"
    )


    txt_dir.mkdir(
        parents=True,
        exist_ok=True,
    )


    run([
        "colmap",
        "model_converter",

        "--input_path",
        sparse_model,

        "--output_path",
        txt_dir,

        "--output_type",
        "TXT",
    ])


    return txt_dir


# =========================================================
# CAMERA PARSING
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


            fx = fy = cx = cy = None


            if model in (
                "SIMPLE_PINHOLE",
                "SIMPLE_RADIAL",
                "RADIAL",
            ):

                focal = (
                    parameters[0]
                )

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
# QUATERNION → ROTATION
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
# PARSE POINTS 3D
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


            point_id = int(
                parts[0]
            )


            xyz = np.array(
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


            points[
                point_id
            ] = xyz


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

        lines = [
            line.rstrip(
                "\n"
            )
            for line
            in file
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


        if (
            not header
        ):

            continue


        parts = (
            header.split()
        )


        if (
            len(
                parts
            )
            <
            10
        ):

            continue


        image_id = int(
            parts[0]
        )


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


                if (
                    point_id <
                    0
                ):

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
# LOAD DEPTH MODEL
# =========================================================

def load_depth_model(
    callback,
):

    report(
        callback,
        48,
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

    width = image.width
    height = image.height


    inputs = processor(
        images=image,
        return_tensors="pt",
    )


    tensor_inputs = {}


    for (
        key,
        value
    ) in inputs.items():

        if (
            torch.is_tensor(
                value
            )
        ):

            tensor_inputs[
                key
            ] = value.to(
                DEVICE
            )

        else:

            tensor_inputs[
                key
            ] = value


    output = model(
        **tensor_inputs
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
                height,
                width,
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


    depth = (
        depth
        .float()
        .cpu()
        .numpy()
    )


    return depth


# =========================================================
# ROBUST LINE FIT
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

            break


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


        predicted = (
            coefficients[0]
            *
            x
            +
            coefficients[1]
        )


        residual = np.abs(
            predicted -
            y
        )


        median = np.median(
            residual[
                mask
            ]
        )


        mad = np.median(
            np.abs(
                residual[
                    mask
                ]
                -
                median
            )
        )


        threshold = max(
            median
            +
            3.5
            *
            mad,
            1e-6,
        )


        new_mask = (
            residual <
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


    denominator = np.maximum(
        np.abs(
            y[
                mask
            ]
        ),
        1e-6,
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
        denominator
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

    }


# =========================================================
# ALIGN RELATIVE DEPTH TO COLMAP
# =========================================================

def align_depth_to_sparse(
    depth,
    image_info,
    camera,
    points3d,
):

    predicted_values = []

    metric_values = []


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


        metric_depth = (
            camera_point[
                2
            ]
        )


        if (
            metric_depth <=
            0
        ):

            continue


        px = int(
            round(
                x * sx
            )
        )


        py = int(
            round(
                y * sy
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


        metric_values.append(
            metric_depth
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


    metric_values = np.asarray(
        metric_values,
        dtype=np.float64,
    )


    # Some models output something depth-like;
    # others behave closer to inverse depth.
    # Test both representations.

    direct_fit = (
        robust_linear_fit(
            predicted_values,
            metric_values,
        )
    )


    reciprocal_input = (
        1.0
        /
        np.maximum(
            predicted_values,
            1e-8,
        )
    )


    inverse_fit = (
        robust_linear_fit(
            reciprocal_input,
            metric_values,
        )
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


    if (
        not candidates
    ):

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


    if (
        mode ==
        "direct"
    ):

        metric_depth = (
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

        metric_depth = (

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


    metric_depth = (
        metric_depth
        .astype(
            np.float32
        )
    )


    metric_depth[
        ~np.isfinite(
            metric_depth
        )
    ] = 0


    metric_depth[
        metric_depth <=
        0
    ] = 0


    return metric_depth


# =========================================================
# BACKPROJECT DEPTH
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


    scale_x = (
        width /
        camera[
            "width"
        ]
    )


    scale_y = (
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
        scale_x
    )


    fy = (
        camera[
            "fy"
        ]
        *
        scale_y
    )


    cx = (
        camera[
            "cx"
        ]
        *
        scale_x
    )


    cy = (
        camera[
            "cy"
        ]
        *
        scale_y
    )


    valid_depth = (
        depth[
            depth >
            0
        ]
    )


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
        5,
    )


    far = np.percentile(
        valid_depth,
        95,
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


    grid_x, grid_y = (
        np.meshgrid(
            xs,
            ys,
        )
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


    # COLMAP:
    #
    # X_cam = R X_world + t
    #
    # therefore:
    #
    # X_world = R^T (X_cam - t)

    world_points = (
        rotation.T
        @
        (
            camera_points
            -
            translation
        )
        .T
    ).T


    rgb = np.asarray(
        image.convert(
            "RGB"
        ),
        dtype=np.float32,
    ) / 255.0


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
# BUILD MULTIVIEW POINT CLOUD
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

    names = [

        name

        for name
        in sorted(
            image_infos.keys()
        )

        if (
            image_dir /
            name
        ).exists()

    ]


    if (
        not names
    ):

        raise RuntimeError(
            "No registered COLMAP "
            "images were found."
        )


    all_points = []

    all_colors = []


    successful_views = 0


    for (
        index,
        name,
    ) in enumerate(
        names
    ):

        progress = (
            52
            +
            (
                28
                *
                (
                    index /
                    max(
                        len(
                            names
                        ),
                        1,
                    )
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
                f"{index + 1}/"
                f"{len(names)}"
            ),
        )


        image_path = (
            image_dir /
            name
        )


        image = Image.open(
            image_path
        ).convert(
            "RGB"
        )


        info = (
            image_infos[
                name
            ]
        )


        camera = cameras[
            info[
                "camera_id"
            ]
        ]


        relative_depth = (
            predict_depth(
                image,
                processor,
                model,
            )
        )


        metric_depth = (
            align_depth_to_sparse(

                relative_depth,

                info,

                camera,

                points3d,

            )
        )


        if (
            metric_depth
            is None
        ):

            print(
                "Skipping view "
                f"{name}: insufficient "
                "sparse scale correspondences."
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

            continue


        all_points.append(
            points
        )


        all_colors.append(
            colors
        )


        successful_views += 1


        # MPS cache management can help
        # long multi-image jobs.
        if (
            DEVICE.type ==
            "mps"
        ):

            try:

                torch.mps.empty_cache()

            except Exception:

                pass


    if (
        successful_views <
        3
    ):

        raise RuntimeError(
            "Too few views produced "
            "usable depth geometry."
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


    diagonal = (
        np.linalg.norm(
            bbox.get_extent()
        )
    )


    if (
        diagonal <=
        0
    ):

        raise RuntimeError(
            "Invalid point-cloud scale."
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
            voxel_size=
                voxel_size
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
                    20,

                std_ratio=
                    2.0,

            )
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
                    40,

            )

    )


    try:

        cloud.orient_normals_consistent_tangent_plane(
            20
        )

    except Exception:

        pass


    return (
        cloud,
        voxel_size,
    )


# =========================================================
# MESH
# =========================================================

def point_cloud_to_mesh(
    cloud,
    voxel_size,
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
                9,

        )
    )


    densities = np.asarray(
        densities
    )


    if (
        densities.size
        >
        0
    ):

        threshold = (
            np.quantile(
                densities,
                0.03,
            )
        )


        low_density = (
            densities <
            threshold
        )


        mesh.remove_vertices_by_mask(
            low_density
        )


    # Crop Poisson's large surrounding
    # surfaces to the observed cloud.

    bbox = (
        cloud
        .get_axis_aligned_bounding_box()
    )


    bbox = (
        bbox.scale(
            1.04,
            bbox.get_center(),
        )
    )


    mesh = (
        mesh.crop(
            bbox
        )
    )


    mesh.remove_degenerate_triangles()
    mesh.remove_duplicated_triangles()
    mesh.remove_duplicated_vertices()
    mesh.remove_non_manifold_edges()
    mesh.compute_vertex_normals()


    success = (
        o3d.io
        .write_triangle_mesh(
            str(
                output_path
            ),
            mesh,
            write_ascii=False,
        )
    )


    if (
        not success
    ):

        raise RuntimeError(
            "Open3D could not "
            "write the reconstructed mesh."
        )


    if (
        not output_path.exists()
    ):

        raise RuntimeError(
            "Reconstructed mesh file "
            "was not created."
        )


    report(
        callback,
        100,
        "Ear mesh reconstruction complete",
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


    if (
        not image_dir.exists()
    ):

        raise RuntimeError(
            f"Image directory "
            f"does not exist: "
            f"{image_dir}"
        )


    images = (
        get_images(
            image_dir
        )
    )


    if (
        len(
            images
        )
        <
        10
    ):

        raise RuntimeError(
            f"Only "
            f"{len(images)} images "
            f"were found."
        )


    if (
        workspace.exists()
    ):

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
        "HAMMER CRAFT HYBRID RECONSTRUCTION"
    )

    print(
        "Images:",
        len(
            images
        ),
    )

    print(
        "OS:",
        platform.system(),
    )

    print(
        "Architecture:",
        platform.machine(),
    )

    print(
        "PyTorch:",
        torch.__version__,
    )

    print(
        "Accelerator:",
        accelerator_name(),
    )

    print(
        "Depth model:",
        DEPTH_MODEL_NAME,
    )

    print(
        "============================================"
        "\n"
    )


    # -----------------------------------------------------
    # COLMAP CAMERA SOLUTION
    # -----------------------------------------------------

    sparse_model = (
        run_colmap(

            image_dir,
            workspace,
            progress_callback,

        )
    )


    # -----------------------------------------------------
    # UNDISTORT
    # -----------------------------------------------------

    (
        dense_root,
        undistorted_images,
        undistorted_sparse,
    ) = undistort_images(

        image_dir,
        sparse_model,
        workspace,
        progress_callback,

    )


    # -----------------------------------------------------
    # TEXT MODEL
    # -----------------------------------------------------

    text_model = (
        convert_model_to_text(

            undistorted_sparse,
            workspace,

        )
    )


    cameras_path = (
        text_model /
        "cameras.txt"
    )


    images_path = (
        text_model /
        "images.txt"
    )


    points_path = (
        text_model /
        "points3D.txt"
    )


    for required in (
        cameras_path,
        images_path,
        points_path,
    ):

        if (
            not required.exists()
        ):

            raise RuntimeError(
                f"COLMAP model file "
                f"missing: "
                f"{required}"
            )


    cameras = (
        parse_cameras(
            cameras_path
        )
    )


    image_infos = (
        parse_images(
            images_path
        )
    )


    points3d = (
        parse_points3d(
            points_path
        )
    )


    if (
        not points3d
    ):

        raise RuntimeError(
            "COLMAP sparse model "
            "contains no usable 3D points."
        )


    # -----------------------------------------------------
    # NEURAL DEPTH
    # -----------------------------------------------------

    (
        processor,
        model,
    ) = load_depth_model(
        progress_callback
    )


    # -----------------------------------------------------
    # DEPTH → MULTIVIEW CLOUD
    # -----------------------------------------------------

    cloud = (
        build_point_cloud(

            undistorted_images,

            cameras,

            image_infos,

            points3d,

            processor,

            model,

            progress_callback,

        )
    )


    # Release neural network before
    # the meshing stage.

    del model
    del processor


    if (
        DEVICE.type ==
        "cuda"
    ):

        torch.cuda.empty_cache()


    elif (
        DEVICE.type ==
        "mps"
    ):

        try:

            torch.mps.empty_cache()

        except Exception:

            pass


    # -----------------------------------------------------
    # POINT CLOUD CLEANUP
    # -----------------------------------------------------

    (
        cloud,
        voxel_size,
    ) = clean_point_cloud(

        cloud,
        progress_callback,

    )


    if (
        len(
            cloud.points
        )
        <
        500
    ):

        raise RuntimeError(
            "Reconstruction produced "
            "too few valid 3D points."
        )


    fused_cloud_path = (
        workspace /
        "fused-neural.ply"
    )


    o3d.io.write_point_cloud(
        str(
            fused_cloud_path
        ),
        cloud,
    )


    # -----------------------------------------------------
    # MESH
    # -----------------------------------------------------

    raw_mesh_path = (
        workspace /
        "raw-mesh.ply"
    )


    return point_cloud_to_mesh(

        cloud,

        voxel_size,

        raw_mesh_path,

        progress_callback,

    )