import Foundation
import ARKit
import simd


struct TriangleMesh {


    var vertices:
        [SIMD3<Float>] = []


    var triangles:
        [(Int, Int, Int)] = []


}



@MainActor
final class MeshCollector:
    ObservableObject {


    @Published
    var meshCount =
        0


    private var anchors:
        [UUID: ARMeshAnchor] =
        [:]



    func clear() {


        anchors.removeAll()


        meshCount =
            0


    }



    func update(
        anchor:
            ARMeshAnchor
    ) {


        anchors[
            anchor.identifier
        ] =
            anchor


        meshCount =
            anchors.count


    }



    func combinedMesh()
        throws
        -> TriangleMesh {


        var output =
            TriangleMesh()


        for anchor
            in anchors.values {


            append(
                anchor:
                    anchor,
                to:
                    &output
            )


        }


        guard
            !output.vertices.isEmpty,
            !output.triangles.isEmpty
        else {


            throw MeshError
                .emptyMesh


        }


        return output


    }



    private func append(
        anchor:
            ARMeshAnchor,
        to mesh:
            inout TriangleMesh
    ) {


        let geometry =
            anchor.geometry


        let vertexOffset =
            mesh.vertices.count



        for index
            in 0..<geometry.vertices.count {


            let local =
                vertex(
                    index:
                        index,
                    source:
                        geometry.vertices
                )


            let transformed =
                anchor.transform *
                SIMD4<Float>(
                    local.x,
                    local.y,
                    local.z,
                    1
                )


            mesh.vertices.append(


                SIMD3<Float>(
                    transformed.x,
                    transformed.y,
                    transformed.z
                )


            )


        }



        for face
            in 0..<geometry.faces.count {


            let indices =
                faceIndices(
                    face:
                        face,
                    element:
                        geometry.faces
                )


            guard
                indices.count ==
                    3
            else {

                continue

            }


            mesh.triangles.append(


                (
                    vertexOffset +
                        indices[0],

                    vertexOffset +
                        indices[1],

                    vertexOffset +
                        indices[2]
                )


            )


        }


    }



    private func vertex(
        index:
            Int,
        source:
            ARGeometrySource
    ) -> SIMD3<Float> {


        let pointer =
            source
                .buffer
                .contents()
                .advanced(
                    by:
                        source.offset +
                        source.stride *
                        index
                )


        return pointer
            .assumingMemoryBound(
                to:
                    SIMD3<Float>.self
            )
            .pointee


    }



    private func faceIndices(
        face:
            Int,
        element:
            ARGeometryElement
    ) -> [Int] {


        let count =
            element
                .indexCountPerPrimitive


        let offset =
            face *
            count *
            element.bytesPerIndex


        let pointer =
            element
                .buffer
                .contents()
                .advanced(
                    by:
                        offset
                )


        var output:
            [Int] = []


        for index
            in 0..<count {


            if element.bytesPerIndex ==
                4 {


                let value =
                    pointer
                        .advanced(
                            by:
                                index * 4
                        )
                        .assumingMemoryBound(
                            to:
                                UInt32.self
                        )
                        .pointee


                output.append(
                    Int(value)
                )


            }


            else {


                let value =
                    pointer
                        .advanced(
                            by:
                                index * 2
                        )
                        .assumingMemoryBound(
                            to:
                                UInt16.self
                        )
                        .pointee


                output.append(
                    Int(value)
                )


            }


        }


        return output


    }



    enum MeshError:
        LocalizedError {


        case emptyMesh


        var errorDescription:
            String? {


            "No usable mesh was captured. Please scan the ear again."


        }


    }


}