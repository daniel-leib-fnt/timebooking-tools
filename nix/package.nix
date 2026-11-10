{ lib, buildNpmPackage, nodejs_22, makeWrapper, libsecret, libnotify }:

buildNpmPackage {
  pname = "timebooking";
  version = "0.1.0";
  src = lib.fileset.toSource {
    root = ../.;
    fileset = lib.fileset.unions [ ../package.json ../package-lock.json ../tsconfig.json ../src ];
  };
  nodejs = nodejs_22;
  npmDepsHash = "sha256-YJMWrEJtJ9BICHsGNVLRSgsu0/OSXkBlEuh0kuvxm0c=";
  nativeBuildInputs = [ makeWrapper ];

  installPhase = ''
    runHook preInstall
    npm prune --omit=dev
    mkdir -p $out/lib/timebooking $out/bin
    cp -r package.json dist node_modules $out/lib/timebooking/
    # secret-tool reads the GFOS password, notify-send serves `--notify`.
    makeWrapper ${nodejs_22}/bin/node $out/bin/timebooking \
      --add-flags $out/lib/timebooking/dist/cli/main.js \
      --prefix PATH : ${lib.makeBinPath [ libsecret libnotify ]}
    runHook postInstall
  '';

  meta = {
    description = "CLI and MCP server for gfos.Workforce time tracking";
    mainProgram = "timebooking";
  };
}
