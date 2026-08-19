/* =========================================================
   HAMMER CRAFT ADMIN
========================================================= */


const adminDB =
    window.hcSupabase;



/* =========================================================
   REQUIRE ADMIN
========================================================= */


async function requireAdmin() {

    const {
        data: userData,
        error: userError
    } =
        await adminDB
            .auth
            .getUser();


    if (
        userError ||
        !userData.user
    ) {

        window.location.replace(
            "login.html"
        );

        return null;

    }


    const user =
        userData.user;


    const {
        data: admin,
        error: adminError
    } =
        await adminDB
            .from(
                "admin_users"
            )
            .select(
                "user_id"
            )
            .eq(
                "user_id",
                user.id
            )
            .maybeSingle();


    if (
        adminError ||
        !admin
    ) {

        window.location.replace(
            "account.html"
        );

        return null;

    }


    return user;

}



/* =========================================================
   LOAD ALL SCANS
========================================================= */


async function loadAdminScans() {

    const list =
        document.getElementById(
            "adminScanList"
        );


    list.innerHTML = `

        <div class="admin-loading">
            Loading scans...
        </div>

    `;


    const {
        data: scans,
        error
    } =
        await adminDB
            .from(
                "ear_scans"
            )
            .select(
                `
                id,
                user_id,
                status,
                left_image_count,
                right_image_count,
                left_stl_path,
                right_stl_path,
                created_at,
                updated_at
                `
            )
            .order(
                "created_at",
                {
                    ascending:
                        false
                }
            );


    if (error) {

        console.error(
            error
        );


        list.innerHTML = `

            <div class="admin-loading">
                Unable to load scans.
            </div>

        `;


        return;

    }


    updateStats(
        scans
    );


    if (
        !scans ||
        scans.length === 0
    ) {

        list.innerHTML = `

            <div class="admin-loading">
                No ear scans yet.
            </div>

        `;


        return;

    }


    list.innerHTML =
        "";


    for (
        const scan
        of scans
    ) {

        const profile =
            await loadProfile(
                scan.user_id
            );


        const card =
            createScanCard(
                scan,
                profile
            );


        list.appendChild(
            card
        );

    }

}



/* =========================================================
   LOAD CUSTOMER PROFILE
========================================================= */


async function loadProfile(
    userID
) {

    const {
        data,
        error
    } =
        await adminDB
            .from(
                "profiles"
            )
            .select(
                "full_name,email"
            )
            .eq(
                "id",
                userID
            )
            .maybeSingle();


    if (error) {

        console.error(
            error
        );

        return {};

    }


    return data || {};

}



/* =========================================================
   STATS
========================================================= */


function updateStats(
    scans
) {

    document
        .getElementById(
            "totalScans"
        )
        .textContent =
        scans.length;


    document
        .getElementById(
            "processingScans"
        )
        .textContent =
        scans.filter(
            scan =>
                scan.status ===
                "processing"
        ).length;


    document
        .getElementById(
            "completeScans"
        )
        .textContent =
        scans.filter(
            scan =>
                scan.status ===
                "complete"
        ).length;


    document
        .getElementById(
            "failedScans"
        )
        .textContent =
        scans.filter(
            scan =>
                scan.status ===
                "failed"
        ).length;

}



/* =========================================================
   CREATE SCAN CARD
========================================================= */


function createScanCard(
    scan,
    profile
) {

    const card =
        document.createElement(
            "article"
        );


    card.className =
        "admin-scan-card";


    const date =
        new Date(
            scan.created_at
        )
        .toLocaleString(
            "en-GB",
            {

                day:
                    "2-digit",

                month:
                    "short",

                year:
                    "numeric",

                hour:
                    "2-digit",

                minute:
                    "2-digit"

            }
        );


    card.innerHTML = `

        <div class="admin-card-top">

            <span>
                ${date}
            </span>

            <strong>
                ${String(scan.status).toUpperCase()}
            </strong>

        </div>


        <h3>
            ${
                profile.full_name ||
                "Customer"
            }
        </h3>


        <div class="admin-customer">

            ${
                profile.email ||
                scan.user_id
            }

        </div>


        <div class="admin-scan-meta">


            <div>

                <span>
                    LEFT EAR
                </span>

                <strong>
                    ${scan.left_image_count}
                    IMAGES
                </strong>

            </div>


            <div>

                <span>
                    RIGHT EAR
                </span>

                <strong>
                    ${scan.right_image_count}
                    IMAGES
                </strong>

            </div>


        </div>


        <div class="admin-scan-id">

            SCAN:
            ${scan.id}

        </div>


        <div class="admin-downloads">

            ${
                scan.left_stl_path
                ? `
                    <button
                        data-file="${scan.left_stl_path}"
                    >
                        DOWNLOAD LEFT STL
                    </button>
                `
                : ""
            }


            ${
                scan.right_stl_path
                ? `
                    <button
                        data-file="${scan.right_stl_path}"
                    >
                        DOWNLOAD RIGHT STL
                    </button>
                `
                : ""
            }

        </div>

    `;


    card
        .querySelectorAll(
            "[data-file]"
        )
        .forEach(
            button => {

                button.addEventListener(
                    "click",

                    () =>
                        openPrivateFile(
                            button.dataset.file
                        )

                );

            }
        );


    return card;

}



/* =========================================================
   PRIVATE FILE LINK
========================================================= */


async function openPrivateFile(
    path
) {

    const {
        data,
        error
    } =
        await adminDB
            .storage
            .from(
                "ear-scans"
            )
            .createSignedUrl(
                path,
                60 * 10
            );


    if (
        error ||
        !data?.signedUrl
    ) {

        console.error(
            error
        );


        alert(
            "Unable to create download link."
        );


        return;

    }


    window.open(
        data.signedUrl,
        "_blank",
        "noopener"
    );

}



/* =========================================================
   LOGOUT
========================================================= */


document
    .getElementById(
        "adminLogoutButton"
    )
    .addEventListener(
        "click",

        async () => {

            await adminDB
                .auth
                .signOut();


            window.location.replace(
                "index.html"
            );

        }

    );



/* =========================================================
   REFRESH
========================================================= */


document
    .getElementById(
        "refreshAdminButton"
    )
    .addEventListener(
        "click",
        loadAdminScans
    );



/* =========================================================
   INITIALISE
========================================================= */


async function initialiseAdmin() {

    const user =
        await requireAdmin();


    if (!user) {
        return;
    }


    document
        .getElementById(
            "adminEmail"
        )
        .textContent =
        user.email;


    await loadAdminScans();

}


initialiseAdmin();