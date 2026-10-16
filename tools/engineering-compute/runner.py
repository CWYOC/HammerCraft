"""Isolated compute dispatcher. Modules own their validation and numerical work."""
import json
from pathlib import Path
import sys
from cad_step import preview_step, validate_request as validate_cad
from harmonic_fem import solve_harmonic, validate_request as validate_harmonic
from modal_fem import solve_modal, validate_request as validate_modal
from mesher import mesh_step, validate_request as validate_mesh
from structural_fem import solve_structural, validate_request as validate_structural
from thermal_fem import solve_thermal, validate_request as validate_thermal

MODULES={'cad-step':(validate_cad,preview_step,'artifact'),'harmonic-tetra':(validate_harmonic,solve_harmonic,'solution'),'modal-tetra':(validate_modal,solve_modal,'solution'),'gmsh-tetra':(validate_mesh,mesh_step,'mesh'),'thermal-tetra':(validate_thermal,solve_thermal,'solution'),'structural-tetra':(validate_structural,solve_structural,'solution')}

def module(data):
    if not isinstance(data,dict) or data.get('kind') not in MODULES:raise ValueError('Unsupported compute job.')
    return MODULES[data['kind']]

def validate_request(data):
    return module(data)[0](data)

if __name__=='__main__':
    request,result,progress=map(Path,sys.argv[1:4])
    def status(state):
        pending=progress.with_suffix('.tmp');pending.write_text(json.dumps({'state':state}));pending.replace(progress)
    try:
        data=json.loads(request.read_text());status('Preparing');output=module(data)[1](data,status)
        result.write_text(json.dumps(output,allow_nan=False,separators=(',',':')));status('Completed')
    except Exception as error:
        result.write_text(json.dumps({'error':str(error)[:2000]}));status('Failed');sys.exit(1)
