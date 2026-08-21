const PROCESSOR_ONLINE_MS =
    35000;


let processorComputers =
    [];


/* =========================================================
   LOAD
========================================================= */

async function loadProcessorComputers() {

    const container =
        document.getElementById(
            "processorMachineList"
        );


    if (
        !container
    ) {

        return;

    }


    const {
        data,
        error
    } =
        await window.hcSupabase
            .from(
                "processors"
            )
            .select(`
                id,
                name,
                platform,
                accelerator,
                app_version,
                status,
                worker_enabled,
                current_scan_id,
                last_seen
            `)
            .order(
                "name",
                {
                    ascending:
                        true
                }
            );


    if (
        error
    ) {

        container.innerHTML = `

            <div class="scan-error">

                Unable to load processors.

                ${escapeProcessorHTML(
                    error.message
                )}

            </div>

        `;

        return;

    }


    processorComputers =
        data ||
        [];


    renderProcessorComputers();

}


/* =========================================================
   ONLINE
========================================================= */

function processorOnline(
    processor
) {

    if (
        !processor.last_seen
    ) {

        return false;

    }


    const lastSeen =
        new Date(
            processor.last_seen
        )
        .getTime();


    if (
        !Number.isFinite(
            lastSeen
        )
    ) {

        return false;

    }


    return (

        Date.now()
        -
        lastSeen

        <=

        PROCESSOR_ONLINE_MS

    );

}


/* =========================================================
   RENDER
========================================================= */

function renderProcessorComputers() {

    const container =
        document.getElementById(
            "processorMachineList"
        );


    if (
        !container
    ) {

        return;

    }


    if (
        processorComputers.length ===
        0
    ) {

        container.innerHTML = `

            <div class="loading-card">

                No processors connected yet.

            </div>

        `;

        return;

    }


    container.innerHTML =
        processorComputers
            .map(
                processor => {

                    const online =
                        processorOnline(
                            processor
                        );


                    let state =
                        "OFFLINE";


                    if (
                        online
                    ) {

                        if (
                            processor.status ===
                            "processing"
                        ) {

                            state =
                                "PROCESSING";

                        }

                        else if (
                            processor.worker_enabled
                        ) {

                            state =
                                "ONLINE / READY";

                        }

                        else {

                            state =
                                "ONLINE / STOPPED";

                        }

                    }


                    return `

                        <article
                            class="processor-machine-card"
                        >

                            <div class="processor-machine-top">

                                <div>

                                    <span class="card-label">

                                        PROCESSOR

                                    </span>


                                    <h3>

                                        ${escapeProcessorHTML(
                                            processor.name ||
                                            "Unnamed processor"
                                        )}

                                    </h3>

                                </div>


                                <span
                                    class="
                                        machine-status
                                        ${
                                            online
                                            ? "machine-online"
                                            : "machine-offline"
                                        }
                                    "
                                >

                                    ${state}

                                </span>

                            </div>


                            <div class="scan-data-grid">

                                <article>

                                    <span>
                                        PLATFORM
                                    </span>

                                    <strong>

                                        ${escapeProcessorHTML(
                                            processor.platform ||
                                            "—"
                                        )}

                                    </strong>

                                </article>


                                <article>

                                    <span>
                                        ACCELERATOR
                                    </span>

                                    <strong>

                                        ${escapeProcessorHTML(
                                            processor.accelerator ||
                                            "—"
                                        )}

                                    </strong>

                                </article>


                                <article>

                                    <span>
                                        VERSION
                                    </span>

                                    <strong>

                                        ${escapeProcessorHTML(
                                            processor.app_version ||
                                            "—"
                                        )}

                                    </strong>

                                </article>


                                <article>

                                    <span>
                                        CURRENT SCAN
                                    </span>

                                    <strong>

                                        ${escapeProcessorHTML(
                                            processor.current_scan_id ||
                                            "NONE"
                                        )}

                                    </strong>

                                </article>

                            </div>


                            <div class="scan-meta">

                                LAST SEEN

                                ${
                                    processor.last_seen

                                    ?

                                    new Date(
                                        processor.last_seen
                                    )
                                    .toLocaleString(
                                        "en-GB"
                                    )

                                    :

                                    "NEVER"
                                }

                            </div>

                        </article>

                    `;

                }
            )
            .join("");

}


/* =========================================================
   ESCAPE
========================================================= */

function escapeProcessorHTML(
    value
) {

    return String(
        value ??
        ""
    )

        .replaceAll(
            "&",
            "&amp;"
        )

        .replaceAll(
            "<",
            "&lt;"
        )

        .replaceAll(
            ">",
            "&gt;"
        )

        .replaceAll(
            '"',
            "&quot;"
        )

        .replaceAll(
            "'",
            "&#039;"
        );

}


/* =========================================================
   START
========================================================= */

loadProcessorComputers();


window.setInterval(

    loadProcessorComputers,

    10000

);