{ lib, stdenvNoCC, fetchPnpmDeps, pnpmConfigHook, pnpm, nodejs_22, makeWrapper, libsecret, libnotify }:

stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "timebooking";
  version = "0.1.0";
  src = lib.fileset.toSource {
    root = ../.;
    fileset = lib.fileset.unions [ ../package.json ../pnpm-lock.yaml ../pnpm-workspace.yaml ../tsconfig.json ../src ];
  };
  pnpmDeps = fetchPnpmDeps {
    inherit (finalAttrs) pname version src;
    fetcherVersion = 4;
    hash = "sha256-rCM8rtbaQaXyHtTO7qNawEeBRUqow2f/ZDplH5Tkd3o=";
  };
  nativeBuildInputs = [ nodejs_22 pnpm pnpmConfigHook makeWrapper ];

  buildPhase = ''
    runHook preBuild
    pnpm build
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    # Keep only the runtime dependencies; `pnpm prune` would query the registry, which the sandbox forbids.
    rm -rf node_modules
    pnpm install --offline --frozen-lockfile --ignore-scripts --prod
    mkdir -p $out/lib/timebooking $out/bin
    cp -r package.json dist node_modules $out/lib/timebooking/
    # secret-tool reads the GFOS password and the calendar URL, notify-send serves `--notify`.
    makeWrapper ${nodejs_22}/bin/node $out/bin/timebooking \
      --add-flags $out/lib/timebooking/dist/cli/main.js \
      --prefix PATH : ${lib.makeBinPath [ libsecret libnotify ]}
    runHook postInstall
  '';

  meta = {
    description = "CLI and MCP server for gfos.Workforce time tracking";
    mainProgram = "timebooking";
  };
})
