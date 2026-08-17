import Foundation


enum UploadService {


    static func upload(
        file:
            URL,
        side:
            String,
        session:
            String,
        apiBase:
            URL
    ) async throws {


        let endpoint =
            apiBase
                .appendingPathComponent(
                    "ear-scans"
                )
                .appendingPathComponent(
                    session
                )
                .appendingPathComponent(
                    side
                )


        var request =
            URLRequest(
                url:
                    endpoint
            )


        request.httpMethod =
            "POST"


        let boundary =
            "HammerCraft-" +
            UUID()
                .uuidString


        request.setValue(

            "multipart/form-data; boundary=\(boundary)",

            forHTTPHeaderField:
                "Content-Type"

        )


        let fileData =
            try Data(
                contentsOf:
                    file
            )


        var body =
            Data()


        body.appendText(
            "--\(boundary)\r\n"
        )


        body.appendText(

            "Content-Disposition: form-data; name=\"scan\"; filename=\"\(side)-ear.stl\"\r\n"

        )


        body.appendText(
            "Content-Type: model/stl\r\n\r\n"
        )


        body.append(
            fileData
        )


        body.appendText(
            "\r\n--\(boundary)--\r\n"
        )


        request.httpBody =
            body


        let (
            _,
            response
        ) =
            try await URLSession
                .shared
                .data(
                    for:
                        request
                )


        guard
            let http =
                response
                    as?
                    HTTPURLResponse,
            200..<300 ~=
                http.statusCode
        else {


            throw UploadError
                .failed


        }


    }



    enum UploadError:
        LocalizedError {


        case failed


        var errorDescription:
            String? {


            "The scan could not be uploaded to Hammer Craft."


        }


    }


}



extension Data {


    mutating func appendText(
        _ text:
            String
    ) {


        guard
            let data =
                text.data(
                    using:
                        .utf8
                )
        else {

            return

        }


        append(data)


    }


}