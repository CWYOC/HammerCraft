import os
import sys
import uuid
import socket
import platform
import threading
import tkinter as tk

from tkinter import (
    ttk,
    messagebox,
)

from datetime import (
    datetime,
    timezone,
)

from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

import worker


# =========================================================
# PATHS
# =========================================================

def get_resource_dir():

    if getattr(
        sys,
        "frozen",
        False,
    ):

        return (
            Path(
                sys.executable
            )
            .resolve()
            .parent
            .parent
            /
            "Resources"
        )


    return (
        Path(
            __file__
        )
        .resolve()
        .parent
    )


RESOURCE_DIR = get_resource_dir()


ENV_PATH = (
    RESOURCE_DIR
    /
    ".env"
)


load_dotenv(
    ENV_PATH
)


# =========================================================
# CONFIG
# =========================================================

SUPABASE_URL = os.environ[
    "SUPABASE_URL"
]


SUPABASE_ANON_KEY = os.environ[
    "SUPABASE_ANON_KEY"
]


PROCESSOR_NAME = os.getenv(
    "PROCESSOR_NAME",
    socket.gethostname(),
)


APP_VERSION = os.getenv(
    "PROCESSOR_APP_VERSION",
    "1.0.0",
)


HEARTBEAT_SECONDS = int(
    os.getenv(
        "PROCESSOR_HEARTBEAT_SECONDS",
        "10",
    )
)


# =========================================================
# USER DATA
# =========================================================

if (
    platform.system() ==
    "Darwin"
):

    USER_DATA_DIR = (

        Path.home()
        /
        "Library"
        /
        "Application Support"
        /
        "Hammer Craft Processor"

    )


elif (
    platform.system() ==
    "Windows"
):

    USER_DATA_DIR = (

        Path(
            os.getenv(
                "LOCALAPPDATA",
                Path.home(),
            )
        )
        /
        "Hammer Craft Processor"

    )


else:

    USER_DATA_DIR = (

        Path.home()
        /
        ".hammer-craft-processor"

    )


USER_DATA_DIR.mkdir(
    parents=True,
    exist_ok=True,
)


DEVICE_ID_PATH = (

    USER_DATA_DIR
    /
    "device-id"

)


# =========================================================
# HELPERS
# =========================================================

def utc_now():

    return (
        datetime
        .now(
            timezone.utc
        )
        .isoformat()
    )


def get_device_id():

    if DEVICE_ID_PATH.exists():

        value = (
            DEVICE_ID_PATH
            .read_text()
            .strip()
        )


        if value:

            return value


    value = str(
        uuid.uuid4()
    )


    DEVICE_ID_PATH.write_text(
        value
    )


    return value


DEVICE_ID = get_device_id()


def detect_accelerator():

    try:

        import torch


        if torch.cuda.is_available():

            return (
                "CUDA / "
                +
                torch.cuda.get_device_name(
                    0
                )
            )


        if (
            hasattr(
                torch.backends,
                "mps",
            )
            and
            torch.backends.mps.is_available()
        ):

            return (
                "MPS / Apple Metal"
            )


    except Exception as error:

        print(
            "Accelerator detection warning:",
            error
        )


    return "CPU"


# =========================================================
# APPLICATION
# =========================================================

class HammerCraftProcessorApp:

    def __init__(
        self,
        root,
    ):

        self.root = root


        self.supabase = create_client(
            SUPABASE_URL,
            SUPABASE_ANON_KEY,
        )


        self.current_user = None


        self.worker_thread = None


        self.worker_stop_event = (
            threading.Event()
        )


        self.heartbeat_job = None


        self.root.title(
            "Hammer Craft Processor"
        )


        self.root.geometry(
            "720x620"
        )


        self.root.minsize(
            620,
            560
        )


        self.root.protocol(
            "WM_DELETE_WINDOW",
            self.on_close,
        )


        self.build_ui()


        self.set_logged_out_state()


    # =====================================================
    # UI
    # =====================================================

    def build_ui(
        self
    ):

        main = ttk.Frame(
            self.root,
            padding=28,
        )


        main.pack(
            fill="both",
            expand=True,
        )


        ttk.Label(

            main,

            text=
                "HAMMER CRAFT",

            font=(
                "Helvetica",
                28,
                "bold",
            ),

        ).pack(
            anchor="w",
        )


        ttk.Label(

            main,

            text=
                "Local Ear Reconstruction Processor",

            font=(
                "Helvetica",
                14,
            ),

        ).pack(

            anchor="w",

            pady=(
                4,
                24,
            ),

        )


        # -------------------------------------------------
        # LOGIN
        # -------------------------------------------------

        self.login_frame = (
            ttk.LabelFrame(

                main,

                text=
                    " Administrator Login ",

                padding=18,

            )
        )


        self.login_frame.pack(

            fill="x",

            pady=(
                0,
                18,
            ),

        )


        self.login_frame.columnconfigure(
            1,
            weight=1,
        )


        ttk.Label(
            self.login_frame,
            text="Email",
        ).grid(
            row=0,
            column=0,
            sticky="w",
            padx=(0, 12),
            pady=7,
        )


        self.email_entry = ttk.Entry(
            self.login_frame
        )


        self.email_entry.grid(
            row=0,
            column=1,
            sticky="ew",
            pady=7,
        )


        ttk.Label(
            self.login_frame,
            text="Password",
        ).grid(
            row=1,
            column=0,
            sticky="w",
            padx=(0, 12),
            pady=7,
        )


        self.password_entry = ttk.Entry(
            self.login_frame,
            show="•",
        )


        self.password_entry.grid(
            row=1,
            column=1,
            sticky="ew",
            pady=7,
        )


        self.login_button = ttk.Button(

            self.login_frame,

            text=
                "SIGN IN",

            command=
                self.login,

        )


        self.login_button.grid(
            row=2,
            column=1,
            sticky="e",
            pady=(12, 0),
        )


        # -------------------------------------------------
        # COMPUTER
        # -------------------------------------------------

        processor_frame = ttk.LabelFrame(

            main,

            text=
                " Processor Computer ",

            padding=18,

        )


        processor_frame.pack(
            fill="x",
            pady=(0, 18),
        )


        processor_frame.columnconfigure(
            1,
            weight=1,
        )


        info = [

            (
                "Name",
                PROCESSOR_NAME,
            ),

            (
                "Computer",
                socket.gethostname(),
            ),

            (
                "Platform",
                (
                    f"{platform.system()} "
                    f"{platform.machine()}"
                ),
            ),

            (
                "Accelerator",
                detect_accelerator(),
            ),

            (
                "App Version",
                APP_VERSION,
            ),

            (
                "Device ID",
                DEVICE_ID,
            ),

        ]


        for (
            row,
            (
                name,
                value,
            ),
        ) in enumerate(
            info
        ):

            ttk.Label(

                processor_frame,

                text=
                    name,

                font=(
                    "Helvetica",
                    10,
                    "bold",
                ),

            ).grid(
                row=row,
                column=0,
                sticky="w",
                padx=(0, 18),
                pady=4,
            )


            ttk.Label(

                processor_frame,

                text=
                    str(
                        value
                    ),

            ).grid(
                row=row,
                column=1,
                sticky="w",
                pady=4,
            )


        # -------------------------------------------------
        # STATUS
        # -------------------------------------------------

        status_frame = ttk.LabelFrame(

            main,

            text=
                " Status ",

            padding=18,

        )


        status_frame.pack(
            fill="x",
            pady=(0, 18),
        )


        self.connection_status = ttk.Label(

            status_frame,

            text=
                "SIGNED OUT",

            font=(
                "Helvetica",
                12,
                "bold",
            ),

        )


        self.connection_status.pack(
            anchor="w",
            pady=4,
        )


        self.worker_status = ttk.Label(

            status_frame,

            text=
                "PROCESSOR STOPPED",

            font=(
                "Helvetica",
                12,
                "bold",
            ),

        )


        self.worker_status.pack(
            anchor="w",
            pady=4,
        )


        self.scan_status = ttk.Label(

            status_frame,

            text=
                "CURRENT SCAN: NONE",

        )


        self.scan_status.pack(
            anchor="w",
            pady=4,
        )


        # -------------------------------------------------
        # BUTTONS
        # -------------------------------------------------

        controls = ttk.Frame(
            main
        )


        controls.pack(
            fill="x"
        )


        controls.columnconfigure(
            0,
            weight=1,
        )


        controls.columnconfigure(
            1,
            weight=1,
        )


        controls.columnconfigure(
            2,
            weight=1,
        )


        self.start_button = ttk.Button(

            controls,

            text=
                "START PROCESSOR",

            command=
                self.start_worker,

        )


        self.start_button.grid(
            row=0,
            column=0,
            sticky="ew",
            padx=(0, 6),
        )


        self.stop_button = ttk.Button(

            controls,

            text=
                "STOP PROCESSOR",

            command=
                self.stop_worker,

        )


        self.stop_button.grid(
            row=0,
            column=1,
            sticky="ew",
            padx=6,
        )


        self.logout_button = ttk.Button(

            controls,

            text=
                "SIGN OUT",

            command=
                self.logout,

        )


        self.logout_button.grid(
            row=0,
            column=2,
            sticky="ew",
            padx=(6, 0),
        )


    # =====================================================
    # UI STATE
    # =====================================================

    def set_logged_out_state(
        self
    ):

        if (
            not self.login_frame
            .winfo_ismapped()
        ):

            self.login_frame.pack(
                fill="x",
                pady=(0, 18),
            )


        self.start_button.state([
            "disabled"
        ])


        self.stop_button.state([
            "disabled"
        ])


        self.logout_button.state([
            "disabled"
        ])


    def set_logged_in_state(
        self
    ):

        self.login_frame.pack_forget()


        self.start_button.state([
            "!disabled"
        ])


        self.stop_button.state([
            "disabled"
        ])


        self.logout_button.state([
            "!disabled"
        ])


    # =====================================================
    # LOGIN
    # =====================================================

    def login(
        self
    ):

        email = (
            self.email_entry
            .get()
            .strip()
        )


        password = (
            self.password_entry
            .get()
        )


        if (
            not email
            or
            not password
        ):

            messagebox.showwarning(

                "Hammer Craft",

                "Enter your administrator email and password.",

            )

            return


        try:

            result = (
                self.supabase
                .auth
                .sign_in_with_password({

                    "email":
                        email,

                    "password":
                        password,

                })
            )


            self.current_user = (
                result.user
            )


            admin_response = (

                self.supabase
                .table(
                    "admin_users"
                )
                .select(
                    "user_id"
                )
                .eq(
                    "user_id",
                    self.current_user.id
                )
                .execute()

            )


            if (
                not admin_response.data
            ):

                self.supabase.auth.sign_out()


                self.current_user = None


                raise RuntimeError(
                    "This account is not a Hammer Craft administrator."
                )


            self.connection_status.config(

                text=
                    f"ONLINE — {email}"

            )


            self.set_logged_in_state()


            self.register_processor()


            # Give worker the SAME authenticated
            # Supabase client.

            worker.configure_worker(

                supabase_client=
                    self.supabase,

                processor_id=
                    DEVICE_ID,

                user_data_dir=
                    USER_DATA_DIR,

            )


            self.send_heartbeat()


        except Exception as error:

            messagebox.showerror(

                "Login failed",

                str(
                    error
                ),

            )


    # =====================================================
    # REGISTER
    # =====================================================

    def register_processor(
        self
    ):

        (

            self.supabase
            .table(
                "processors"
            )
            .upsert({

                "id":
                    DEVICE_ID,

                "name":
                    PROCESSOR_NAME,

                "platform":
                    (
                        f"{platform.system()} "
                        f"{platform.machine()}"
                    ),

                "accelerator":
                    detect_accelerator(),

                "app_version":
                    APP_VERSION,

                "status":
                    "stopped",

                "worker_enabled":
                    False,

                "current_scan_id":
                    None,

                "last_seen":
                    utc_now(),

                "updated_at":
                    utc_now(),

            })
            .execute()

        )


    # =====================================================
    # START WORKER
    # =====================================================

    def start_worker(
        self
    ):

        if (
            not self.current_user
        ):

            return


        if (
            self.worker_thread
            and
            self.worker_thread.is_alive()
        ):

            return


        self.worker_stop_event.clear()


        self.worker_thread = (
            threading.Thread(

                target=
                    worker.main,

                kwargs={

                    "stop_event":
                        self.worker_stop_event,

                },

                daemon=True,

            )
        )


        self.worker_thread.start()


        self.worker_status.config(
            text=
                "PROCESSOR READY"
        )


        self.start_button.state([
            "disabled"
        ])


        self.stop_button.state([
            "!disabled"
        ])


        self.update_processor_record(

            status=
                "idle",

            worker_enabled=
                True,

        )


    # =====================================================
    # STOP
    # =====================================================

    def stop_worker(
        self
    ):

        if (
            self.worker_thread
            and
            self.worker_thread.is_alive()
        ):

            self.worker_stop_event.set()


            self.worker_status.config(
                text=
                    "PROCESSOR STOPPING..."
            )


        else:

            self.worker_status.config(
                text=
                    "PROCESSOR STOPPED"
            )


        self.start_button.state([
            "!disabled"
        ])


        self.stop_button.state([
            "disabled"
        ])


    # =====================================================
    # PROCESSOR DB UPDATE
    # =====================================================

    def update_processor_record(
        self,
        status,
        worker_enabled,
    ):

        if (
            not self.current_user
        ):

            return


        try:

            (

                self.supabase
                .table(
                    "processors"
                )
                .update({

                    "status":
                        status,

                    "worker_enabled":
                        worker_enabled,

                    "last_seen":
                        utc_now(),

                    "updated_at":
                        utc_now(),

                })
                .eq(
                    "id",
                    DEVICE_ID
                )
                .execute()

            )


        except Exception as error:

            print(
                "Processor status error:",
                error
            )


    # =====================================================
    # HEARTBEAT
    # =====================================================

    def send_heartbeat(
        self
    ):

        if (
            not self.current_user
        ):

            return


        worker_alive = (

            self.worker_thread
            is not None

            and

            self.worker_thread.is_alive()

        )


        try:

            response = (

                self.supabase
                .table(
                    "processors"
                )
                .select(
                    "status,current_scan_id"
                )
                .eq(
                    "id",
                    DEVICE_ID
                )
                .execute()

            )


            record = (

                response.data[
                    0
                ]

                if response.data

                else {}

            )


            current_scan = (
                record.get(
                    "current_scan_id"
                )
            )


            status = (
                record.get(
                    "status"
                )
                or
                "stopped"
            )


            if (
                not worker_alive
            ):

                status = (
                    "stopped"
                )


            (

                self.supabase
                .table(
                    "processors"
                )
                .update({

                    "last_seen":
                        utc_now(),

                    "status":
                        status,

                    "worker_enabled":
                        worker_alive,

                    "updated_at":
                        utc_now(),

                })
                .eq(
                    "id",
                    DEVICE_ID
                )
                .execute()

            )


            self.scan_status.config(

                text=

                    "CURRENT SCAN: "

                    +

                    (
                        str(
                            current_scan
                        )

                        if current_scan

                        else "NONE"
                    )

            )


            if (
                worker_alive
                and
                status ==
                "processing"
            ):

                self.worker_status.config(
                    text=
                        "PROCESSOR BUSY"
                )


            elif worker_alive:

                self.worker_status.config(
                    text=
                        "PROCESSOR READY"
                )


            else:

                self.worker_status.config(
                    text=
                        "PROCESSOR STOPPED"
                )


        except Exception as error:

            print(
                "Heartbeat error:",
                error
            )


        self.heartbeat_job = (

            self.root.after(

                HEARTBEAT_SECONDS
                *
                1000,

                self.send_heartbeat,

            )

        )


    # =====================================================
    # LOGOUT
    # =====================================================

    def logout(
        self
    ):

        self.stop_worker()


        if (
            self.heartbeat_job
        ):

            self.root.after_cancel(
                self.heartbeat_job
            )


            self.heartbeat_job = None


        self.update_processor_record(
            "offline",
            False,
        )


        try:

            self.supabase.auth.sign_out()


        except Exception:

            pass


        self.current_user = None


        self.connection_status.config(
            text=
                "SIGNED OUT"
        )


        self.scan_status.config(
            text=
                "CURRENT SCAN: NONE"
        )


        self.set_logged_out_state()


    # =====================================================
    # CLOSE
    # =====================================================

    def on_close(
        self
    ):

        try:

            self.worker_stop_event.set()


            self.update_processor_record(
                "offline",
                False,
            )


        except Exception:

            pass


        self.root.destroy()


# =========================================================
# START
# =========================================================

def main():

    root = tk.Tk()


    HammerCraftProcessorApp(
        root
    )


    root.mainloop()


if __name__ == "__main__":

    main()