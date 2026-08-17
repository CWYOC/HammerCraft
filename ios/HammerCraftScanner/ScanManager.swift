import Foundation
import UIKit


@MainActor
final class ScanManager:
    ObservableObject {


    enum EarSide:
        String {

        case left

        case right

    }


    @Published
    var side:
        EarSide?


    @Published
    var sessionID:
        String?


    @Published
    var uploadComplete =
        false


    @Published
    var status =
        "Ready"


    let apiBase =
        URL(
            string:
                "https://www.hammer-craft.co.uk/api"
        )!

    let returnBase =
        "https://www.hammer-craft.co.uk/ear-scan.html"


    var ready:
        Bool {

        side != nil &&
        sessionID != nil

    }



    func handleURL(
        _ url: URL
    ) {


        guard
            let components =
                URLComponents(
                    url: url,
                    resolvingAgainstBaseURL:
                        false
                )
        else {

            return

        }


        let items =
            components
                .queryItems
            ?? []


        let sideString =
            items
                .first {
                    $0.name ==
                    "side"
                }?
                .value


        let session =
            items
                .first {
                    $0.name ==
                    "session"
                }?
                .value


        guard
            let sideString,
            let side =
                EarSide(
                    rawValue:
                        sideString
                ),
            let session
        else {

            return

        }


        self.side =
            side


        self.sessionID =
            session


        self.uploadComplete =
            false


        self.status =
            "Ready"


    }



    func upload(
        file: URL
    ) async throws {


        guard
            let side,
            let sessionID
        else {

            throw ScanError
                .missingSession

        }


        status =
            "Uploading scan..."


        try await UploadService
            .upload(
                file:
                    file,
                side:
                    side.rawValue,
                session:
                    sessionID,
                apiBase:
                    apiBase
            )


        status =
            "Upload complete"


        uploadComplete =
            true


    }



    func returnToWebsite() {


        guard
            let side,
            let sessionID
        else {

            return

        }


        var components =
            URLComponents(
                string:
                    returnBase
            )!


        components.queryItems = [


            URLQueryItem(
                name:
                    "return",
                value:
                    "1"
            ),


            URLQueryItem(
                name:
                    "side",
                value:
                    side.rawValue
            ),


            URLQueryItem(
                name:
                    "session",
                value:
                    sessionID
            )


        ]


        guard
            let url =
                components.url
        else {

            return

        }


        UIApplication
            .shared
            .open(url)


    }



    enum ScanError:
        Error {

        case missingSession

    }


}