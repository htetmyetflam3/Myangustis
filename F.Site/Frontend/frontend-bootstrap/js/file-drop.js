export function onFileDrop(drop, onFile) {
  drop.addEventListener("dragover", (event) => {
    event.preventDefault();
    drop.classList.add("is-over");
  });
  drop.addEventListener("dragleave", (event) => {
    event.preventDefault();
    drop.classList.remove("is-over");
  });
  drop.addEventListener("drop", (event) => {
    event.preventDefault();
    drop.classList.remove("is-over");
    const [file] = event.dataTransfer.files;
    if (file) onFile(file);
  });
}
