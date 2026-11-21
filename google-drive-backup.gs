/**
 * LUXION — respaldo de un único archivo JSON en Google Drive.
 * La app envía un formulario POST con dos campos: key y payload.
 * No necesitas crear una hoja de cálculo ni un servidor privado.
 */

const LUXION_FOLDER_NAME = 'LUXION - Copias de seguridad';
const LUXION_FILE_NAME = 'LUXION_BACKUP.json';
const LUXION_SECRET_PROPERTY = 'LUXION_KEY';

function doPost(e) {
  try {
    const expectedKey = PropertiesService.getScriptProperties().getProperty(LUXION_SECRET_PROPERTY);
    const receivedKey = e && e.parameter ? e.parameter.key : '';
    if (!expectedKey || !receivedKey || receivedKey !== expectedKey) {
      return page_('No autorizado. Revisa la clave configurada en Apps Script.');
    }

    const rawPayload = e.parameter.payload || '';
    if (!rawPayload || rawPayload.length > 450000) {
      return page_('La copia está vacía o supera el tamaño permitido para este script.');
    }

    const parsed = JSON.parse(rawPayload);
    if (parsed.application !== 'LUXION' || !parsed.data) {
      return page_('El contenido recibido no corresponde a una copia LUXION.');
    }

    const folder = getOrCreateFolder_();
    const files = folder.getFilesByName(LUXION_FILE_NAME);
    const contents = JSON.stringify(parsed, null, 2);

    if (files.hasNext()) {
      files.next().setContent(contents);
    } else {
      folder.createFile(LUXION_FILE_NAME, contents, MimeType.PLAIN_TEXT);
    }

    return page_('Copia de LUXION recibida. Puedes cerrar esta pestaña interna.');
  } catch (error) {
    return page_('No se pudo guardar la copia: ' + String(error));
  }
}

function doGet() {
  return page_('Servicio de copia de seguridad LUXION activo.');
}

function getOrCreateFolder_() {
  const folders = DriveApp.getFoldersByName(LUXION_FOLDER_NAME);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(LUXION_FOLDER_NAME);
}

function page_(message) {
  // El mensaje se escapa para no interpretar texto como HTML.
  const safeMessage = String(message)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  return HtmlService.createHtmlOutput(
    '<!doctype html><html><head><meta charset="utf-8"><title>LUXION Backup</title></head>' +
    '<body style="font-family:Arial,sans-serif;background:#08080b;color:#eee;padding:24px">' +
    '<h2>LUXION</h2><p>' + safeMessage + '</p></body></html>'
  );
}
