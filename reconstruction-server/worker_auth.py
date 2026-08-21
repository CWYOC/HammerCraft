import os

from supabase import create_client


def create_worker_client(
    url: str,
    anon_key: str,
):

    access_token = os.getenv(
        "HC_ACCESS_TOKEN"
    )


    refresh_token = os.getenv(
        "HC_REFRESH_TOKEN"
    )


    if (
        not access_token
        or
        not refresh_token
    ):

        raise RuntimeError(
            "Worker must be started from Hammer Craft Processor."
        )


    client = create_client(
        url,
        anon_key,
    )


    client.auth.set_session(
        access_token,
        refresh_token,
    )


    return client