{ lib, stdenvNoCC }:

stdenvNoCC.mkDerivation {
  pname = "timebooking-plasmoid";
  version = "0.1";
  src = ../plasmoid;
  dontBuild = true;
  installPhase = ''
    runHook preInstall
    target=$out/share/plasma/plasmoids/com.github.daniel-leib-fnt.timebooking
    mkdir -p $target
    cp -r metadata.json contents $target/
    runHook postInstall
  '';
  meta.description = "Plasma widget showing the GFOS clock state and today's net working time";
}
