import Foundation
import simd


enum STLExporter {


    static func export(
        mesh:
            TriangleMesh,
        filename:
            String
    ) throws
        -> URL {


        let url =
            FileManager
                .default
                .temporaryDirectory
                .appendingPathComponent(
                    filename
                )


        var stl =
            "solid HammerCraftEar\n"



        for triangle
            in mesh.triangles {


            let a =
                mesh.vertices[
                    triangle.0
                ] *
                1000


            let b =
                mesh.vertices[
                    triangle.1
                ] *
                1000


            let c =
                mesh.vertices[
                    triangle.2
                ] *
                1000


            let normal =
                normal(
                    a,
                    b,
                    c
                )


            stl +=
            """
              facet normal \(normal.x) \(normal.y) \(normal.z)
                outer loop
                  vertex \(a.x) \(a.y) \(a.z)
                  vertex \(b.x) \(b.y) \(b.z)
                  vertex \(c.x) \(c.y) \(c.z)
                endloop
              endfacet

            """


        }


        stl +=
            "endsolid HammerCraftEar\n"


        try stl.write(

            to:
                url,

            atomically:
                true,

            encoding:
                .utf8

        )


        return url


    }



    private static func normal(
        _ a:
            SIMD3<Float>,
        _ b:
            SIMD3<Float>,
        _ c:
            SIMD3<Float>
    ) -> SIMD3<Float> {


        let cross =
            simd_cross(
                b - a,
                c - a
            )


        let length =
            simd_length(
                cross
            )


        if length <
            0.000001 {


            return .zero


        }


        return cross /
            length


    }


}