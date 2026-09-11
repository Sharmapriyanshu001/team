/**
 * Saving a file the browser fetched behind a panel's token.
 *
 * Nothing in uploads/ is served statically — every download goes through a
 * route that checks who is asking — so a plain <a href> cannot carry the
 * token and the bytes have to arrive as a blob first. This is the last step
 * of that: hand the blob to the browser under the name it should be saved as.
 */
export const saveBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename || "download";
  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(url);
};
