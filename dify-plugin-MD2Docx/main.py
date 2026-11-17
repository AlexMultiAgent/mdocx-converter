import os
from dify_plugin import DifyPluginEnv, Plugin

# Signal to Dify SDK internals that we are running inside the plugin sandbox.
# Must be the very first action — before Plugin() touches stdio transport.
os.environ["LOAD_FROM_DIFY_PLUGIN"] = "1"

# The conversion stages are budgeted to 165 seconds; keep 15 seconds in reserve
# for transport and runtime startup before the 180-second connection deadline.
plugin = Plugin(DifyPluginEnv(MAX_REQUEST_TIMEOUT=180))

if __name__ == "__main__":
    plugin.run()
