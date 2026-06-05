import os
from dify_plugin import DifyPluginEnv, Plugin

# Signal to Dify SDK internals that we are running inside the plugin sandbox.
# Must be the very first action — before Plugin() touches stdio transport.
os.environ["LOAD_FROM_DIFY_PLUGIN"] = "1"

plugin = Plugin(DifyPluginEnv(MAX_REQUEST_TIMEOUT=120))

if __name__ == "__main__":
    plugin.run()
