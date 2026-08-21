import os
import platform
import shutil
import socket
import time

from datetime import (
    datetime,
    timezone,
)

from pathlib import Path

from dotenv import load_dotenv

from reconstruct import reconstruct
from mesh_cleanup import clean_mesh


# =========================================================
# ENVIRONMENT
# =========================================================

load_dotenv()


SUPABASE_BUCKET = os.getenv(
    "SUPABASE_BUCKET",
    "ear-scans",
)


POLL_SECONDS = int(
    os.getenv(
        "POLL_SECONDS",
        "5",
    )
)


TARGET_IMAGES_PER_EAR = int(
    os.getenv(
        "TARGET_IMAGES_PER_EAR",
        "120",
    )
)


MIN_IMAGES_PER_EAR = int(
    os.getenv(
        "MIN_IMAGES_PER_EAR",
        "90",
    )
)


MESH_VOXEL_RESOLUTION = int(
    os.getenv(
        "MESH_VOXEL_RESOLUTION",
        "350",
    )
)


AUTO_PROCESS_UPLOADED = (
    os.getenv(
        "AUTO_PROCESS_UPLOADED",
        "false",
    )
    .strip()
    .lower()
    in (
        "1",
        "true",
        "yes",
        "on",
    )
)


PROCESSOR_NAME = os.getenv(
    "PROCESSOR_NAME",
    socket.gethostname(),
)


PROCESSOR_PLATFORM = (
    f"{platform.system()} "
    f"{platform.machine()}"
)


# =========================================================
# RUNTIME VALUES
#
# These are supplied by processor_app.py after admin login.
# =========================================================

supabase = None

PROCESSOR_ID = None

WORK_ROOT = None


# =========================================================
# CONFIGURE WORKER
# =========================================================

def configure_worker(
    supabase_client,
    processor_id,
    user_data_dir,
):

    global supabase
    global PROCESSOR_ID
    global WORK_ROOT


    supabase = (
        supabase_client
    )


    PROCESSOR_ID = (
        processor_id
    )


    WORK_ROOT = (

        Path(
            user_data_dir
        )
        /
        "work"

    )


    WORK_ROOT.mkdir(
        parents=True,
        exist_ok=True,
    )


    print(
        "Worker configured."
    )


    print(
        "Processor ID:",
        PROCESSOR_ID
    )


    print(
        "Work directory:",
        WORK_ROOT
    )


# =========================================================
# VALIDATE CONFIGURATION
# =========================================================

def ensure_configured():

    if (
        supabase is None
    ):

        raise RuntimeError(
            "Hammer Craft worker has not been configured."
        )


    if (
        PROCESSOR_ID is None
    ):

        raise RuntimeError(
            "Processor ID is missing."
        )


    if (
        WORK_ROOT is None
    ):

        raise RuntimeError(
            "Worker directory is missing."
        )


# =========================================================
# TIME
# =========================================================

def utc_now():

    return (
        datetime
        .now(
            timezone.utc
        )
        .isoformat()
    )


# =========================================================
# DATABASE
# =========================================================

def update_scan(
    scan_id,
    values,
):

    ensure_configured()


    values[
        "updated_at"
    ] = utc_now()


    return (

        supabase
        .table(
            "ear_scans"
        )
        .update(
            values
        )
        .eq(
            "id",
            scan_id
        )
        .execute()

    )


def update_processor(
    values,
):

    ensure_configured()


    values[
        "updated_at"
    ] = utc_now()


    return (

        supabase
        .table(
            "processors"
        )
        .update(
            values
        )
        .eq(
            "id",
            PROCESSOR_ID
        )
        .execute()

    )


# =========================================================
# PROGRESS
# =========================================================

def set_progress(
    scan_id,
    percent,
    stage,
    accelerator=None,
):

    percent = max(
        0,
        min(
            100,
            int(
                percent
            ),
        ),
    )


    print(
        f"[{percent:3d}%] "
        f"{stage}",
        flush=True,
    )


    values = {

        "progress_percent":
            percent,

        "progress_stage":
            stage,

        "processor_name":
            PROCESSOR_NAME,

        "processor_platform":
            PROCESSOR_PLATFORM,

    }


    if accelerator:

        values[
            "processor_accelerator"
        ] = accelerator


    try:

        update_scan(
            scan_id,
            values,
        )


    except Exception as error:

        # Compatibility fallback in case your DB
        # does not yet have processor_accelerator.

        print(
            "Progress update warning:",
            error
        )


        values.pop(
            "processor_accelerator",
            None,
        )


        update_scan(
            scan_id,
            values,
        )


# =========================================================
# STORAGE IMAGE LIST
# =========================================================

def get_storage_images(
    user_id,
    scan_id,
    side,
):

    ensure_configured()


    prefix = (
        f"{user_id}/"
        f"{scan_id}/"
        f"{side}"
    )


    print(
        "Listing storage:",
        prefix
    )


    entries = (

        supabase
        .storage
        .from_(
            SUPABASE_BUCKET
        )
        .list(
            prefix
        )

    )


    filenames = []


    for entry in entries:

        if isinstance(
            entry,
            dict,
        ):

            name = entry.get(
                "name"
            )


        else:

            name = getattr(
                entry,
                "name",
                None,
            )


        if (
            name
            and
            name.lower().endswith(
                (
                    ".jpg",
                    ".jpeg",
                    ".png",
                )
            )
        ):

            filenames.append(
                name
            )


    filenames.sort()


    return (
        prefix,
        filenames,
    )


# =========================================================
# DOWNLOAD EAR IMAGES
# =========================================================

def download_side(
    user_id,
    scan_id,
    side,
    destination,
):

    ensure_configured()


    destination = Path(
        destination
    )


    destination.mkdir(
        parents=True,
        exist_ok=True,
    )


    (
        prefix,
        filenames,
    ) = get_storage_images(
        user_id,
        scan_id,
        side,
    )


    count = len(
        filenames
    )


    print(
        "\n"
        "--------------------------------------"
    )


    print(
        side.upper(),
        "EAR"
    )


    print(
        "--------------------------------------"
    )


    print(
        "Images:",
        count
    )


    if (
        count <
        MIN_IMAGES_PER_EAR
    ):

        raise RuntimeError(

            f"{side} ear has only "
            f"{count} images. "

            f"Minimum required is "
            f"{MIN_IMAGES_PER_EAR}."

        )


    if (
        count <
        TARGET_IMAGES_PER_EAR
    ):

        print(

            f"WARNING: "
            f"target is "
            f"{TARGET_IMAGES_PER_EAR}; "
            f"using {count}."

        )


    bucket = (

        supabase
        .storage
        .from_(
            SUPABASE_BUCKET
        )

    )


    for (
        index,
        filename,
    ) in enumerate(
        filenames,
        start=1,
    ):

        remote_path = (
            f"{prefix}/"
            f"{filename}"
        )


        print(

            f"Downloading "
            f"{side} "
            f"{index}/{count}: "
            f"{filename}"

        )


        file_bytes = (
            bucket.download(
                remote_path
            )
        )


        local_path = (
            destination
            /
            filename
        )


        local_path.write_bytes(
            file_bytes
        )


    return count


# =========================================================
# UPLOAD STL
# =========================================================

def upload_stl(
    user_id,
    scan_id,
    side,
    local_path,
):

    ensure_configured()


    local_path = Path(
        local_path
    )


    if (
        not local_path.exists()
    ):

        raise RuntimeError(

            f"STL file missing: "
            f"{local_path}"

        )


    if (
        local_path.stat().st_size
        <=
        0
    ):

        raise RuntimeError(
            "Generated STL is empty."
        )


    remote_path = (

        f"{user_id}/"
        f"{scan_id}/"
        f"results/"
        f"{side}-ear.stl"

    )


    print(
        "Uploading STL:",
        remote_path
    )


    bucket = (

        supabase
        .storage
        .from_(
            SUPABASE_BUCKET
        )

    )


    # -----------------------------------------------------
    # REMOVE PREVIOUS FILE IF IT EXISTS
    # -----------------------------------------------------

    try:

        bucket.remove(
            [
                remote_path
            ]
        )


    except Exception as error:

        print(
            "Previous STL removal warning:",
            error
        )


    # -----------------------------------------------------
    # UPLOAD
    # -----------------------------------------------------

    bucket.upload(

        path=
            remote_path,

        file=
            local_path.read_bytes(),

        file_options={

            "content-type":
                "model/stl",

        },

    )


    print(
        "STL uploaded."
    )


    return remote_path


# =========================================================
# PROCESS ONE EAR
# =========================================================

def process_side(
    scan,
    side,
    workspace,
    progress_start,
    progress_end,
):

    scan_id = scan[
        "id"
    ]


    user_id = scan[
        "user_id"
    ]


    side_title = (

        "Left"

        if side ==
        "left"

        else "Right"

    )


    side_root = (
        workspace
        /
        side
    )


    images_dir = (
        side_root
        /
        "images"
    )


    reconstruction_dir = (
        side_root
        /
        "reconstruction"
    )


    output_stl = (

        workspace
        /
        "results"
        /
        f"{side}-ear.stl"

    )


    output_stl.parent.mkdir(
        parents=True,
        exist_ok=True,
    )


    # =====================================================
    # DOWNLOAD
    # =====================================================

    set_progress(

        scan_id,

        progress_start,

        (
            f"Downloading "
            f"{side_title.lower()} "
            f"ear images"
        ),

    )


    image_count = download_side(

        user_id,

        scan_id,

        side,

        images_dir,

    )


    print(

        f"{side_title} ear: "
        f"{image_count} "
        f"images downloaded."

    )


    # =====================================================
    # RECONSTRUCTION PROGRESS MAPPING
    # =====================================================

    progress_range = (
        progress_end
        -
        progress_start
    )


    def reconstruction_progress(
        relative_percent,
        stage,
        accelerator=None,
    ):

        relative_percent = max(
            0,
            min(
                100,
                float(
                    relative_percent
                ),
            ),
        )


        overall = (

            progress_start

            +

            (
                progress_range
                *
                relative_percent
                /
                100.0
            )

        )


        set_progress(

            scan_id,

            overall,

            (
                f"{side_title}: "
                f"{stage}"
            ),

            accelerator=
                accelerator,

        )


    # =====================================================
    # RECONSTRUCT
    # =====================================================

    raw_mesh = reconstruct(

        images_dir,

        reconstruction_dir,

        progress_callback=
            reconstruction_progress,

    )


    raw_mesh = Path(
        raw_mesh
    )


    if (
        not raw_mesh.exists()
    ):

        raise RuntimeError(

            f"{side_title} reconstruction "
            f"did not create a mesh."

        )


    # =====================================================
    # CLEAN
    # =====================================================

    set_progress(

        scan_id,

        progress_end - 3,

        (
            f"Cleaning "
            f"{side_title.lower()} "
            f"ear mesh"
        ),

    )


    final_stl = clean_mesh(

        raw_mesh,

        output_stl,

        force_solid=
            True,

        voxel_resolution=
            MESH_VOXEL_RESOLUTION,

    )


    # =====================================================
    # UPLOAD
    # =====================================================

    set_progress(

        scan_id,

        progress_end - 1,

        (
            f"Uploading "
            f"{side_title.lower()} "
            f"ear STL"
        ),

    )


    return upload_stl(

        user_id,

        scan_id,

        side,

        final_stl,

    )


# =========================================================
# CLAIM SCAN
# =========================================================

def claim_scan(
    scan,
):

    ensure_configured()


    scan_id = scan[
        "id"
    ]


    old_status = scan[
        "status"
    ]


    print(
        "Claiming scan:",
        scan_id
    )


    response = (

        supabase
        .table(
            "ear_scans"
        )
        .update({

            "status":
                "processing",

            "progress_percent":
                1,

            "progress_stage":
                "Preparing local reconstruction",

            "processor_name":
                PROCESSOR_NAME,

            "processor_platform":
                PROCESSOR_PLATFORM,

            "processing_started_at":
                utc_now(),

            "processing_finished_at":
                None,

            "error_message":
                None,

            "updated_at":
                utc_now(),

        })
        .eq(
            "id",
            scan_id
        )
        .eq(
            "status",
            old_status
        )
        .execute()

    )


    # Supabase can return an empty data array if
    # another worker claimed the same scan first.

    if (
        response.data
        is not None
        and
        len(
            response.data
        )
        ==
        0
    ):

        print(
            "Scan was already claimed."
        )


        return False


    return True


# =========================================================
# PROCESS COMPLETE SCAN
# =========================================================

def process_scan(
    scan,
):

    ensure_configured()


    scan_id = scan[
        "id"
    ]


    if (
        not claim_scan(
            scan
        )
    ):

        return


    print(
        "\n\n"
        "=============================================="
    )


    print(
        "HAMMER CRAFT EAR SCAN"
    )


    print(
        "=============================================="
    )


    print(
        "Scan:",
        scan_id
    )


    print(
        "Processor:",
        PROCESSOR_NAME
    )


    print(
        "Platform:",
        PROCESSOR_PLATFORM
    )


    print(
        "=============================================="
        "\n"
    )


    workspace = (
        WORK_ROOT
        /
        scan_id
    )


    if workspace.exists():

        shutil.rmtree(
            workspace
        )


    workspace.mkdir(
        parents=True,
        exist_ok=True,
    )


    # =====================================================
    # PROCESSOR STATUS
    # =====================================================

    update_processor({

        "status":
            "processing",

        "worker_enabled":
            True,

        "current_scan_id":
            scan_id,

    })


    try:

        # =================================================
        # LEFT
        # =================================================

        left_path = process_side(

            scan,

            "left",

            workspace,

            4,

            48,

        )


        # =================================================
        # RIGHT
        # =================================================

        right_path = process_side(

            scan,

            "right",

            workspace,

            52,

            96,

        )


        # =================================================
        # COMPLETE
        # =================================================

        update_scan(
            scan_id,
            {

                "status":
                    "complete",

                "progress_percent":
                    100,

                "progress_stage":
                    "Reconstruction complete",

                "left_stl_path":
                    left_path,

                "right_stl_path":
                    right_path,

                "processing_finished_at":
                    utc_now(),

                "error_message":
                    None,

            },
        )


        print(
            "\nSCAN COMPLETE:",
            scan_id
        )


    except Exception as error:

        print(
            "\nSCAN FAILED:",
            scan_id
        )


        print(
            error
        )


        try:

            update_scan(
                scan_id,
                {

                    "status":
                        "failed",

                    "progress_stage":
                        "Reconstruction failed",

                    "processing_finished_at":
                        utc_now(),

                    "error_message":
                        str(
                            error
                        )[:10000],

                },
            )


        except Exception as database_error:

            print(
                "Unable to save failure status:",
                database_error
            )


    finally:

        try:

            update_processor({

                "status":
                    "idle",

                "worker_enabled":
                    True,

                "current_scan_id":
                    None,

            })


        except Exception as processor_error:

            print(
                "Unable to reset processor state:",
                processor_error
            )


# =========================================================
# GET PENDING SCANS
# =========================================================

def get_pending_scans():

    ensure_configured()


    statuses = [
        "queued"
    ]


    if AUTO_PROCESS_UPLOADED:

        statuses.append(
            "uploaded"
        )


    response = (

        supabase
        .table(
            "ear_scans"
        )
        .select(
            "*"
        )
        .in_(
            "status",
            statuses
        )
        .order(
            "updated_at",
            desc=False,
        )
        .limit(
            1
        )
        .execute()

    )


    return (
        response.data
        or []
    )


# =========================================================
# WAIT
# =========================================================

def wait_for_next_poll(
    stop_event=None,
):

    if stop_event:

        stop_event.wait(
            POLL_SECONDS
        )


    else:

        time.sleep(
            POLL_SECONDS
        )


# =========================================================
# MAIN WORKER LOOP
# =========================================================

def main(
    stop_event=None,
):

    ensure_configured()


    print(
        "\n"
        "=============================================="
    )


    print(
        " HAMMER CRAFT RECONSTRUCTION WORKER"
    )


    print(
        "=============================================="
    )


    print(
        "Processor:",
        PROCESSOR_NAME
    )


    print(
        "Platform:",
        PROCESSOR_PLATFORM
    )


    print(
        "Bucket:",
        SUPABASE_BUCKET
    )


    print(
        "Work directory:",
        WORK_ROOT
    )


    print(
        "Target images per ear:",
        TARGET_IMAGES_PER_EAR
    )


    print(
        "Minimum images per ear:",
        MIN_IMAGES_PER_EAR
    )


    print(
        "Poll interval:",
        POLL_SECONDS,
        "seconds"
    )


    print(
        "Auto process uploaded:",
        AUTO_PROCESS_UPLOADED
    )


    print(
        "=============================================="
        "\n"
    )


    update_processor({

        "status":
            "idle",

        "worker_enabled":
            True,

        "current_scan_id":
            None,

    })


    try:

        while True:

            # -------------------------------------------------
            # STOP REQUEST
            # -------------------------------------------------

            if (
                stop_event
                and
                stop_event.is_set()
            ):

                break


            try:

                scans = (
                    get_pending_scans()
                )


                if scans:

                    for scan in scans:

                        if (
                            stop_event
                            and
                            stop_event.is_set()
                        ):

                            break


                        process_scan(
                            scan
                        )


                else:

                    wait_for_next_poll(
                        stop_event
                    )


            except Exception as error:

                print(
                    "Worker loop error:",
                    error
                )


                wait_for_next_poll(
                    stop_event
                )


    finally:

        try:

            update_processor({

                "status":
                    "stopped",

                "worker_enabled":
                    False,

                "current_scan_id":
                    None,

            })


        except Exception as error:

            print(
                "Unable to mark processor stopped:",
                error
            )


        print(
            "\nHammer Craft reconstruction worker stopped."
        )