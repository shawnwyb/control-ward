"""JSON-lines bridge. Runs only inside the restricted, disposable Docker sandbox."""
import contextlib
import io
import json
import sys
import traceback

channel_in, channel_out = sys.stdin, sys.stdout

def send(value):
    channel_out.write(json.dumps(value) + "\n")
    channel_out.flush()

def tool(name, **arguments):
    send({"type": "tool", "name": name, "arguments": arguments})
    reply = json.loads(channel_in.readline())
    if "error" in reply:
        raise RuntimeError(reply["error"])
    return reply["value"]

def get_site_context():
    return tool("get_site_context")

def search_official_sources(query):
    return tool("search_official_sources", query=query)

def read_source(source_id, offset=0):
    return tool("read_source", source_id=source_id, offset=offset)

def check_proposal(items):
    return tool("check_proposal", items=items)

class BoundedOutput(io.StringIO):
    def write(self, value):
        if self.tell() + len(value) > 20000:
            raise RuntimeError("execution_output_limit")
        return super().write(value)

scope = {name: value for name, value in globals().copy().items()
         if name in ("get_site_context", "search_official_sources", "read_source", "check_proposal", "json")}
scope["__builtins__"] = __builtins__
for line in channel_in:
    request = json.loads(line)
    output = BoundedOutput()
    error = None
    try:
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
            exec(compile(request["code"], "<agent-action>", "exec"), scope, scope)
    except BaseException as exception:
        error = "".join(traceback.format_exception_only(type(exception), exception))[:2000]
    send({"type": "result", "output": output.getvalue(), "error": error})
