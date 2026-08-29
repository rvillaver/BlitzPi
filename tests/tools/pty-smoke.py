import os, pty, select, time, sys, re

cmd = ["/home/rvillaver/.bun/bin/blitzpi"]
cwd = "/home/rvillaver/Work/blitz/BlitzPi"
captured = bytearray()

def read_ready(fd, t=0.3):
    try:
        r,_,_ = select.select([fd],[],[],t)
        return bool(r)
    except Exception:
        return False

pid, fd = pty.fork()
if pid == 0:
    os.chdir(cwd)
    os.environ["TERM"]="xterm-256color"
    os.execv(cmd[0], cmd)
else:
    # give it time to boot + render startup resource view
    deadline = time.time() + 14
    while time.time() < deadline:
        if read_ready(fd):
            try: captured += os.read(fd, 65536)
            except OSError: break
    # press ctrl+o to expand full startup help / loaded resources
    try: os.write(fd, b"\x0f")
    except OSError: pass
    t2 = time.time() + 5
    while time.time() < t2:
        if read_ready(fd):
            try: captured += os.read(fd, 65536)
            except OSError: break
    # quit
    try: os.write(fd, b"/exit\r")
    except OSError: pass
    time.sleep(2)
    try: os.write(fd, b"\x04")  # ctrl-d
    except OSError: pass
    time.sleep(1)
    try: os.close(fd)
    except OSError: pass
    try: os.waitpid(pid, os.WNOHANG)
    except OSError: pass

raw = bytes(captured)
open(sys.argv[1],"wb").write(raw)
# strip ANSI for analysis
txt = re.sub(rb'\x1b\[[0-9;?]*[a-zA-Z]', b'', raw)
txt = re.sub(rb'\x1b[()][AB0]', b'', txt).replace(b'\r', b'')
open(sys.argv[1]+".txt","wb").write(txt)
t = txt.decode('utf-8','replace')
print("=== ANALYSIS ===")
print("Invalid theme:", t.count("Invalid theme"))
print("Missing required color:", t.count("Missing required color"))
print("blitzpi-dark referenced:", t.count("blitzpi-dark"))
print("[Themes] block present:", "[Themes]" in t)
print("[Theme conflicts] present:", "[Theme conflicts]" in t)
print("mascot 'v0.84.3' line:", "v0.84.3" in t)
# show the themes region
m = re.search(r'\[Themes\].*?(?=\n\n|\[|─{5}|$)', t, re.S)
if m: print("--- [Themes] region ---\n"+m.group(0)[:400])
mc = re.search(r'\[Theme conflicts\].*?(?=\n\n\[|─{5}|$)', t, re.S)
if mc: print("--- [Theme conflicts] region ---\n"+mc.group(0)[:300])
