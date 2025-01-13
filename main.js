import startRt from "./rt.surql?raw"
import surrealObj from "./surreal.obj?raw"

const DIM = [64, 64]

const canvas = document.getElementById("display");
canvas.width = DIM[0];
canvas.height = DIM[0];
const imageContext = canvas.getContext("2d");
imageContext.scale(4, 4);

async function socket(addr) {
  return await new Promise((ok, err) => {
    const ws = new WebSocket(addr, "json");
    ws.onerror = err;

    let pending = new Map();
    let listeners = [];

    let id = 0;

    ws.sendCmd = function(method, ...params) {
      const newId = ++id;
      ws.send(JSON.stringify({ id: newId, method, params }));

      return new Promise((resolve, reject) => {
        pending.set(newId, {
          resolve, reject
        });
      })
    }

    ws.onLiveQuery = function(id, cb) {
      const obj = { id, cb }
      listeners.push(obj);
      return () => {
        listeners = listeners.filter(x => {
          x !== obj
        })
      }
    }

    ws.onmessage = (m) => {
      let data = JSON.parse(m.data);
      if (data.id) {
        const listener = pending.get(data.id);
        if (!pending.delete(data.id)) {
          return
        }
        if (data.error) {
          listener.reject(data.error);
        } else {
          listener.resolve(data.result);
        }

      } else {
        listeners.forEach(cb => {
          if (cb.id === data.result.id) {
            cb.cb(data.result)
          }
        })
      }
    }

    ws.onopen = () => {
      ok(ws)
    };
  })
}

function setPixel(x, y, color) {
  const d = imageContext.createImageData(1, 1);
  d.data[0] = color[0];
  d.data[1] = color[1];
  d.data[2] = color[2];
  d.data[3] = 255;
  imageContext.putImageData(d, x, y);
}

async function readObj(text, transpose, scale) {
  let lines = text.match(/[^\r\n]+/g);

  const verticies = [];
  for (const l of lines) {
    const lSplit = l.split(" ");
    if (lSplit[0] == 'v') {
      verticies.push([
        parseFloat(lSplit[1]),
        parseFloat(lSplit[3]),
        parseFloat(lSplit[2]),
      ])
    }
  }

  let vAcc = [0, 0, 0];

  for (const v of verticies) {
    for (let i = 0; i < 3; i++) {
      vAcc[i] += v[i]
    }
  }

  vAcc[0] /= verticies.length;
  vAcc[1] /= verticies.length;
  vAcc[2] /= verticies.length;

  for (const v of verticies) {
    for (let i = 0; i < 3; i++) {
      v[i] -= vAcc[i]
      v[i] *= scale[i]
      v[i] += transpose[i]
    }
  }

  lines = text.match(/[^\r\n]+/g);

  const triangles = [];

  for (const l of lines) {
    const lSplit = l.split(" ");
    if (lSplit[0] == 'f') {
      triangles.push([
        verticies[parseInt(lSplit[1]) - 1],
        verticies[parseInt(lSplit[2]) - 1],
        verticies[parseInt(lSplit[3]) - 1],
      ])
    }
  }

  return triangles;
}

async function loadObj(sock, materialId, text, transpose, scale) {
  const triangles = await readObj(text, transpose, scale);

  for (const t of triangles) {
    await sock.sendCmd("create", "triangles", {
      vertices: t,
      material: materialId,
    })
  }
}



async function main() {
  console.log("Starting");
  const sock = await socket("ws://127.0.0.1:8000/rpc");
  console.log("Connected");
  await sock.sendCmd("signin", { user: "root", pass: "root" });
  console.log("Logged in");
  await sock.sendCmd("use", "t", "t");
  await sock.sendCmd("query", "remove db t");
  await sock.sendCmd("query", "remove ns t");
  await sock.sendCmd("use", "t", "t");

  let id = await sock.sendCmd("live", "pixels");
  sock.onLiveQuery(id, m => {
    const [x, y] = m.result.position;
    setPixel(x, y, m.result.color);
  })

  try {
    await sock.sendCmd("query", startRt);
  } catch (e) {
    console.log(e.message);
  }
  const imageId = await sock.sendCmd("create", "image", { width: DIM[0], height: DIM[1] });

  let color = [188, 0, 221];
  for (let i = 0; i < 3; i++) {
    color[i] /= 255;
    color[i] * 2.0;
  }

  const matId = await sock.sendCmd("create", "material", {
    albedo: [1.0, 0.0, 0.0],
    fuzz: 0.0,
    emissive: false,
  });
  const matId2 = await sock.sendCmd("create", "material", {
    albedo: [0.8, 1.0, 0.8],
    fuzz: 0.0,
    emissive: false,
  });
  const matId3 = await sock.sendCmd("create", "material", {
    albedo: color,
    fuzz: 0.0,
    emissive: true,
  })

  await sock.sendCmd("create", "spheres", {
    radius: 0.5,
    position: [-1.0, 0.0, -1.0],
    material: matId.id,
  })
  await sock.sendCmd("create", "spheres", {
    radius: 10,
    position: [6, 0.0, -11.0],
    material: matId2.id,
  })

  await sock.sendCmd("create", "spheres", {
    radius: 0.5,
    position: [-1.0, 1.3, -1.0],
    material: matId2.id,
  })

  await loadObj(sock, matId3.id, surrealObj, [0, 0, -0.8], [1, 1, 1]);

  console.log("tracing");
  const traceRes = await sock.sendCmd("query", "fn::trace($image)", { image: imageId.id });
  traceRes.forEach(x => {
    if (x.status === "ERR") {
      console.error(x.result);
    }
  })
  console.log("Tracing took", traceRes[0].time);
  console.log("done");

}
main().catch(console.error);
