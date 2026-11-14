# PTY transport for the scoped LOCAL stop carrier. No process discovery or signalling.
import os
import pty
import select
import subprocess
import sys
import fcntl
import termios
import struct
import json

master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 40, 140, 0, 0))
with open(sys.argv[1]) as spec:
    args = json.load(spec)
child = subprocess.Popen(args, stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
os.close(slave)
print('OWN_TUI_PID=' + str(child.pid), file=sys.stderr, flush=True)
while child.poll() is None:
    ready, _, _ = select.select([master, sys.stdin.fileno()], [], [], 0.1)
    if master in ready:
        try:
            data = os.read(master, 65536)
        except OSError:
            break
        if data:
            os.write(sys.stdout.fileno(), data)
    if sys.stdin.fileno() in ready:
        data = os.read(sys.stdin.fileno(), 65536)
        if data:
            os.write(master, data)
code = child.wait()
print('OWN_TUI_EXIT=' + str(code), file=sys.stderr, flush=True)
sys.exit(code if code >= 0 else 128 - code)
