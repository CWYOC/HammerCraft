// Build against HeadphoneWorkshop's engine objects. See HEADPHONE_WORKSHOP_PORT.md.
#include "flowmodeler/app/ProductExperience.hpp"
#include <iomanip>
#include <iostream>
using namespace flowmodeler;
void vec(core::Vec3 v, double scale=1) { std::cout << '[' << v.x*scale << ',' << v.y*scale << ',' << v.z*scale << ']'; }
int main(int argc, char**) {
    std::cout << std::setprecision(17);
    if (argc > 1) {
        std::cout << '[';
        for (int i=0;i<18;++i) {
            const auto p=static_cast<app::IemDriverUnitPreset>(i);
            const auto& s=app::iemDriverUnitSpecification(p);
            const auto& a=app::iemDriverIntegrationSpecification(p);
            if(i) std::cout << ',';
            std::cout << "{\"id\":" << i << ",\"name\":" << std::quoted(s.modelName)
                << ",\"technology\":" << std::quoted(s.technology) << ",\"size_mm\":"; vec(s.modeledSizeMeters,1000);
            std::cout << ",\"cylindrical\":" << (s.cylindrical?"true":"false")
                << ",\"supplier_dimensioned\":" << (s.supplierDimensioned?"true":"false")
                << ",\"supplier_interface_dimensioned\":" << (a.supplierInterfaceDimensioned?"true":"false")
                << ",\"note\":" << std::quoted(s.integrationNote) << ",\"source_url\":" << std::quoted(s.sourceUrl)
                << ",\"outlet_mm\":"; vec(a.acousticOutletOffsetMeters,1000);
            std::cout << ",\"outlet_axis\":"; vec(a.acousticOutletAxis);
            std::cout << ",\"outlet_diameter_mm\":" << a.acousticOutletDiameterMeters*1000
                << ",\"dedicated_drive\":" << (a.dedicatedDriveElectronicsRequired?"true":"false")
                << ",\"rear_vent_required\":" << (a.rearVentMustRemainOpen?"true":"false") << '}';
        }
        std::cout << "]\n";
        return 0;
    }
    std::cout << '[';
    for(int k=0;k<3;++k) {
        core::AcousticTubePath p;
        p.p0={0,0,0}; p.p1={.004,.001,.002}; p.p2={.008,.003,-.001}; p.p3={.012,0,0};
        p.outerRadius=.0012; p.innerRadius=.0008;
        if(k==1) {p.inletOuterRadius=.0018;p.inletInnerRadius=.0011;}
        if(k==2) {p.p1=p.p0;p.p2={0,0,.006};p.p3={0,0,.012};}
        auto m=core::Mesh::makeSweptTube("parity",p,24,12);
        if(k)std::cout<<',';
        std::cout<<"{\"control_points\":[";vec(p.p0,1000);std::cout<<',';vec(p.p1,1000);std::cout<<',';vec(p.p2,1000);std::cout<<',';vec(p.p3,1000);
        std::cout<<"],\"outer_radius_mm\":"<<p.outerRadius*1000<<",\"inner_radius_mm\":"<<p.innerRadius*1000
          <<",\"inlet_outer_radius_mm\":"<<p.inletOuterRadius*1000<<",\"inlet_inner_radius_mm\":"<<p.inletInnerRadius*1000
          <<",\"path_segments\":24,\"radial_segments\":12,\"mesh\":{\"vertices\":[";
        bool first=true;for(auto v:m.vertices()){if(!first)std::cout<<',';first=false;vec(v,1000);}
        std::cout<<"],\"triangles\":[";first=true;
        for(auto t:m.triangles()){if(!first)std::cout<<',';first=false;std::cout<<'['<<t.indices[0]<<','<<t.indices[1]<<','<<t.indices[2]<<']';}
        std::cout<<"]}}";
    }
    std::cout<<"]\n";
}
