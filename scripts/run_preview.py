#!/usr/bin/env python3
"""Trusted manual preview job: sealed inputs, frozen tools, sealed selected evidence."""
import argparse,base64,gzip,hashlib,json,os,platform,shutil,subprocess,sys,tarfile,time
from pathlib import Path
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

SOURCE='fb41913c619e0dac6c66b08ee44e1ee18ce67aa8'
HEADER=b'VKFBENCH1'
p=argparse.ArgumentParser();p.add_argument('--target',required=True);a=p.parse_args()
repository=Path(__file__).resolve().parents[1]
pins=json.loads((repository/'inputs/pins.json').read_text());assert pins['compiler_source']==SOURCE
key=base64.b64decode(os.environ['SOURCE983_INPUT_KEY']);assert len(key)==32
private=Path(os.environ.get('RUNNER_TEMP',str(repository.parent)))/('vkf-private-'+a.target)
assert not private.exists();private.mkdir()
public=repository/'job-results';public.mkdir(exist_ok=True)
state={'scope':'Diagnostic 0.7.2 preview, not C0/P0 or stable acceptance','target':a.target,'compiler_source':SOURCE,'recipe_sha256':pins['recipe_sha256'],'portable_browser_tar_sha256':pins['portable_browser_tar_sha256'],'runs_per_working_case':10,'host':platform.platform(),'machine':platform.machine(),'runner':{k:os.environ.get(k)for k in ['RUNNER_OS','RUNNER_ARCH','ImageOS','ImageVersion','GITHUB_RUN_ID','GITHUB_SHA']},'phases':[],'completed':False,'physical_gpu_tested':False}

def sha(p):
    with Path(p).open('rb')as f:return hashlib.file_digest(f,'sha256').hexdigest()
def save():
    (private/'execution.json').write_text(json.dumps(state,indent=2)+'\n')
    # Public status has no raw diagnostics, command lines or private directory names.
    (public/'status.json').write_text(json.dumps(state,indent=2)+'\n')
def run(label,command,timeout=1800,cwd=None,extra_env=None,required=True):
    log=private/(label+'.log');start=time.monotonic()
    try:
        with log.open('w')as f:r=subprocess.run(list(map(str,command)),cwd=cwd,env={**os.environ,**(extra_env or {}),'DISPLAY':'','WAYLAND_DISPLAY':''},stdout=f,stderr=subprocess.STDOUT,timeout=timeout)
        code=r.returncode
    except subprocess.TimeoutExpired:code=124
    state['phases'].append({'label':label,'exit':code,'seconds':time.monotonic()-start,'log_sha256':sha(log)});save();print(label,code,flush=True)
    if required and code:raise RuntimeError('Phase failed: '+label)
    return code

def build_windows(bundle):
    manifest=json.loads((bundle/'manifest.json').read_text());source=private/'compiler-source';source.mkdir()
    with tarfile.open(bundle/'source970.tar.gz')as f:f.extractall(source,filter='data')
    for i,name in enumerate(manifest['ordered_appendices']):
        patch=private/('appendix-'+str(i)+'.patch');patch.write_bytes(gzip.decompress((bundle/name).read_bytes()))
        run('patch-check-'+str(i),['git','-c','core.autocrlf=false','apply','--check',patch],cwd=source)
        run('patch-'+str(i),['git','-c','core.autocrlf=false','apply',patch],cwd=source)
    assert {str(p.relative_to(source)).replace('\\','/'):sha(p)for p in source.rglob('*')if p.is_file()}==manifest['candidate_files']
    build=private/'compiler-build'
    run('compiler-configure',['cmake','-S',source/'compiler/native','-B',build,'-G','Visual Studio 17 2022','-A','x64','-T','ClangCL','-DCMAKE_BUILD_TYPE=Release','-DCMAKE_CXX_COMPILER_LAUNCHER='],timeout=600)
    targets=['vkf_strict','vkf','vkf_compiler_artifact_smoke','vkf_lexer_cursor_smoke','vkf_parser_token_stream_smoke','vkf_ast_to_ir_smoke','vkf_retained_scene_packet_probe','vkf_symbolic_kernel_artifact','vkf_x64_artifact']
    # The unused freestanding runner helper is deliberately excluded on Windows.
    run('compiler-build',['cmake','--build',build,'--config','Release','--target',*targets,'--parallel','2'],timeout=3600)
    frozen=private/'frozen-tools';shutil.copytree(build/'bin',frozen)
    binaries=list(frozen.rglob('vkf-strict.exe'));assert len(binaries)==1
    compiler_bin=binaries[0].parent
    receipt={'compiler_source':SOURCE,'recipe_sha256':pins['recipe_sha256'],'source_files_verified':len(manifest['candidate_files']),'compiler_sha256':sha(compiler_bin/'vkf-strict.exe'),'frozen_files':{str(f.relative_to(frozen)):sha(f)for f in frozen.rglob('*')if f.is_file()},'built_once':True,'source_unchanged':{str(p.relative_to(source)).replace('\\','/'):sha(p)for p in source.rglob('*')if p.is_file()}==manifest['candidate_files']}
    assert receipt['source_unchanged'];(private/'compiler-identity.json').write_text(json.dumps(receipt,indent=2)+'\n');return compiler_bin

def prepare_peers(harness):
    peers=private/'symbolic-peers';peers.mkdir()
    report={'scope':'Original pinned symbolic peers, unchanged workloads/oracles','source_inputs':{str(p.relative_to(harness)).replace('\\','/'):sha(p)for p in(harness/'benchmarks/symbolic-comparison/julia').rglob('*')if p.is_file()},'commands':[],'completed':False}
    boost=peers/'boost_1_86_0.tar.bz2'
    import urllib.request
    with urllib.request.urlopen('https://archives.boost.io/release/1.86.0/source/'+boost.name,timeout=120)as response,boost.open('wb')as f:shutil.copyfileobj(response,f)
    assert sha(boost)=='1bed88e40401b2cb7a1f76d4bab499e352fa4d0c5f31c0dbae64e24d34d7513b'
    with tarfile.open(boost)as f:f.extractall(peers,members=(m for m in f if m.name.startswith('boost_1_86_0/boost/')),filter='data')
    sym=peers/'symengine';run('symengine-init',['git','init',sym]);run('symengine-remote',['git','-C',sym,'remote','add','origin','https://github.com/symengine/symengine.git']);run('symengine-fetch',['git','-C',sym,'fetch','--depth','1','origin','0c183629a35dd9d8123fafcc47b0e0283bbae80d']);run('symengine-checkout',['git','-C',sym,'checkout','--detach','FETCH_HEAD'])
    boost_args=['-DBoost_DIR='+str(harness/'benchmarks/symbolic-comparison/cmake'),'-DBOOST_ROOT='+str(peers/'boost_1_86_0')]
    run('symengine-configure',['cmake','-S',sym,'-B',peers/'symengine-build','-G','Ninja','-DCMAKE_BUILD_TYPE=Release','-DINTEGER_CLASS=boostmp','-DBUILD_TESTS=OFF','-DBUILD_BENCHMARKS=OFF',*boost_args])
    run('symengine-build',['cmake','--build',peers/'symengine-build','--parallel','2'],timeout=2400)
    run('symengine-runner-configure',['cmake','-S',harness/'benchmarks/symbolic-comparison/competitors','-B',peers/'symengine-runner','-G','Ninja','-DCMAKE_BUILD_TYPE=Release','-DSymEngine_DIR='+str(peers/'symengine-build'),*boost_args])
    run('symengine-runner-build',['cmake','--build',peers/'symengine-runner','--parallel','2'])
    julia=Path(shutil.which('julia')).resolve();assert subprocess.check_output([julia,'--version'],text=True).strip()=='julia version 1.12.6'
    project=peers/'julia-project';shutil.copytree(harness/'benchmarks/symbolic-comparison/julia',project)
    env={'JULIA_DEPOT_PATH':str(peers/'julia-depot'),'JULIA_NUM_THREADS':'1','JULIA_NUM_PRECOMPILE_TASKS':'2','OPENBLAS_NUM_THREADS':'1','OMP_NUM_THREADS':'1'}
    run('julia-instantiate',[julia,'--project='+str(project),'--startup-file=no','-e','using Pkg; Pkg.instantiate(); Pkg.precompile()'],timeout=3600,extra_env=env)
    assert {str(p.relative_to(project)).replace('\\','/'):sha(p)for p in project.rglob('*')if p.is_file()}=={str(p.relative_to(harness/'benchmarks/symbolic-comparison/julia')).replace('\\','/'):sha(p)for p in(harness/'benchmarks/symbolic-comparison/julia').rglob('*')if p.is_file()}
    exe=peers/'symengine-runner'/('symengine_runner.exe'if os.name=='nt'else 'symengine_runner')
    report.update(completed=True,julia_path=str(julia),julia_sha256=sha(julia),symengine_binary_sha256=sha(exe),julia_project_unchanged=True,commands=[{'label':x['label'],'exit':x['exit']}for x in state['phases']if x['label'].startswith(('symengine','julia'))])
    (peers/'receipt.json').write_text(json.dumps(report,indent=2)+'\n');return peers

try:
    sealed=(repository/'inputs/source983-01.enc').read_bytes();assert hashlib.sha256(sealed).hexdigest()==pins['ciphertext_sha256'];assert sealed[:len(HEADER)]==HEADER
    plain=AESGCM(key).decrypt(sealed[len(HEADER):len(HEADER)+12],sealed[len(HEADER)+12:],HEADER);assert hashlib.sha256(plain).hexdigest()==pins['plaintext_archive_sha256']
    archive=private/'inputs.tar.gz';archive.write_bytes(plain);inputs=private/'inputs';inputs.mkdir()
    with tarfile.open(archive)as f:f.extractall(inputs,filter='data')
    identity=json.loads((inputs/'identity.json').read_text());assert all(sha(inputs/name)==digest for name,digest in identity['private_files'].items());assert sha(inputs/'preview-recipe11.json')==pins['recipe_sha256']
    bundle=inputs/'candidate11'
    if a.target=='windows-x64':compiler_bin=build_windows(bundle);suites='core,linalg,symbolic'
    else:
        root=inputs/'frozen'/a.target;receipt=json.loads((root/'receipt.json').read_text());compiler_bin=root/'bin'
        assert all(sha(compiler_bin/name)==digest for name,digest in receipt['frozen_files'].items())
        assert receipt['bundle_sha256']==pins['portable_manifest_sha256'];state['adopted_compiler_origin_run']=pins['frozen_origin_run'];(private/'compiler-identity.json').write_text(json.dumps(receipt,indent=2)+'\n')
        suites='symbolic'if a.target=='macos-arm64'else 'core,linalg,symbolic'
    suffix='.exe'if os.name=='nt'else '';state['compiler_sha256']=sha(compiler_bin/('vkf-strict'+suffix));state['frozen_files']={f.name:sha(f)for f in compiler_bin.iterdir()if f.is_file()};save()
    harness=private/'harness';harness.mkdir()
    with tarfile.open(bundle/'benchmark-inputs58.tar.gz')as f:f.extractall(harness,filter='data')
    peers=prepare_peers(harness)
    wrapper=inputs/'helpers/run_preview_benchmarks_0136.py'
    # Interpreter discovery only: algorithms, sample count, timeouts and oracles remain exact.
    text=wrapper.read_text();original="julia=peers/'julia-1.12.6/bin'/('julia'+suffix)";assert text.count(original)==1
    wrapper.write_text(text.replace(original,"julia=Path(peer_identity.get('julia_path',str(peers/'julia-1.12.6/bin'/('julia'+suffix))))"))
    run('benchmarks',[sys.executable,wrapper,'--bundle',bundle,'--compiler-bin',compiler_bin,'--work',private/'measurements','--suites',suites,'--prepare-competitors','--symbolic-peer-work',peers],timeout=10800,required=False)
    measurement=json.loads((private/'measurements/receipt.json').read_text());state['completed']=measurement['completed'];state['requested_suites']=suites;state['all_benchmark_commands_passed']=measurement['all_commands_passed'];state['tool_versions']={}
    for tool in ['node','rustc','cargo','zig','julia','cmake']:
        path=shutil.which(tool)
        if path:
            result=subprocess.run([path,'--version'],capture_output=True,text=True,timeout=30);state['tool_versions'][tool]=(result.stdout+result.stderr).strip()[:1000]
except Exception as error:
    state['setup_failure_type']=type(error).__name__
    # Exact exception is private evidence, never emitted into public Actions logs.
    (private/'failure.txt').write_text(str(error)+'\n')
finally:
    save()
    evidence=private/'selected-evidence.tar.gz'
    selected=[private/'execution.json',private/'compiler-identity.json',private/'failure.txt',*private.glob('*.log')]
    selected+=list((private/'measurements').glob('receipt.json'))+list((private/'measurements').glob('command-*.log'))
    for directory in [private/'measurements/harness/benchmark-results',private/'measurements/harness/benchmarks/core-comparison/results']:
        selected+=list(directory.glob('*preview072*.json'))
    selected+=list((private/'symbolic-peers').glob('receipt.json'))
    with tarfile.open(evidence,'w:gz')as f:
        for file in selected:
            if file.is_file():f.add(file,arcname=str(file.relative_to(private)),recursive=False)
    nonce=os.urandom(12);sealed=HEADER+nonce+AESGCM(key).encrypt(nonce,evidence.read_bytes(),HEADER);(public/'selected-evidence.enc').write_bytes(sealed)
    print('Preview attempt terminal:',state['completed'],'; raw selected evidence encrypted',flush=True)
raise SystemExit(0 if state['completed'] else 1)
