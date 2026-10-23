import de.bwaldvogel.mongo.MongoServer;
import de.bwaldvogel.mongo.MongoVersion;
import de.bwaldvogel.mongo.backend.memory.MemoryBackend;
import java.util.List;

/**
 * Minimal stand-in for the `mongod` binary used by the test-suite in
 * environments that cannot download real MongoDB binaries.
 *
 * It is built on mongo-java-server (an in-memory, wire-protocol compatible
 * MongoDB implementation from Maven Central), accepts the subset of mongod
 * flags that mongodb-memory-server passes (--port, --bind_ip; everything
 * else is ignored), answers `--version` in mongod's format, and prints the
 * "waiting for connections" line mongodb-memory-server waits for.
 */
public class Launcher {
  /** Advertise MongoDB 5.0 / wire version 13 so current drivers accept us. */
  static final MongoVersion MONGO_5_0 = new MongoVersion() {
    public List<Integer> getVersionArray() { return List.of(5, 0, 0); }
    public int getWireVersion() { return 13; }
  };

  public static void main(String[] args) throws Exception {
    int port = 27017;
    String host = "127.0.0.1";
    for (int i = 0; i < args.length; i++) {
      if ("--port".equals(args[i]) && i + 1 < args.length) {
        port = Integer.parseInt(args[++i]);
      } else if ("--bind_ip".equals(args[i]) && i + 1 < args.length) {
        host = args[++i];
      } else if ("--version".equals(args[i])) {
        System.out.println("db version v5.0.0");
        System.out.println("mongo-java-server in-memory emulation (test shim)");
        return;
      }
    }
    MongoServer server = new MongoServer(new MemoryBackend().version(MONGO_5_0));
    server.bind(host, port);
    System.out.println("waiting for connections on port " + port);
    System.out.flush();
    Runtime.getRuntime().addShutdownHook(new Thread(server::shutdown));
    Thread.currentThread().join();
  }
}
