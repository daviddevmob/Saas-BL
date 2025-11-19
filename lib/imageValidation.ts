/**
 * Allowed image formats
 */
const ALLOWED_FORMATS = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];

/**
 * Allowed file extensions
 */
const ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'];

/**
 * Maximum file size in bytes (5MB)
 */
const MAX_FILE_SIZE = 5 * 1024 * 1024;

/**
 * Minimum image dimensions in pixels
 */
const MIN_WIDTH = 100;
const MIN_HEIGHT = 100;

/**
 * Maximum image dimensions in pixels
 */
const MAX_WIDTH = 5000;
const MAX_HEIGHT = 5000;

export interface ImageValidationError {
  field: string;
  message: string;
}

/**
 * Validate image file
 */
export const validateImageFile = (file: File): ImageValidationError | null => {
  // Check file exists
  if (!file) {
    return {
      field: 'file',
      message: 'Nenhum arquivo foi selecionado',
    };
  }

  // Check file size
  if (file.size > MAX_FILE_SIZE) {
    return {
      field: 'size',
      message: `O arquivo é muito grande. Tamanho máximo: 5MB (você enviou ${(file.size / 1024 / 1024).toFixed(2)}MB)`,
    };
  }

  // Check MIME type
  if (!ALLOWED_FORMATS.includes(file.type)) {
    return {
      field: 'format',
      message: `Formato de arquivo não permitido. Formatos aceitos: ${ALLOWED_EXTENSIONS.join(', ').toUpperCase()}`,
    };
  }

  // Check file extension (double validation)
  const fileExtension = file.name.split('.').pop()?.toLowerCase();
  if (!fileExtension || !ALLOWED_EXTENSIONS.includes(fileExtension)) {
    return {
      field: 'extension',
      message: `Extensão de arquivo não permitida. Extensões aceitas: ${ALLOWED_EXTENSIONS.join(', ').toUpperCase()}`,
    };
  }

  // Check file name length
  if (file.name.length > 255) {
    return {
      field: 'filename',
      message: 'Nome do arquivo é muito longo (máximo 255 caracteres)',
    };
  }

  return null;
};

/**
 * Validate image dimensions
 */
export const validateImageDimensions = async (file: File): Promise<ImageValidationError | null> => {
  return new Promise((resolve) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      const img = new Image();

      img.onload = () => {
        // Check minimum dimensions
        if (img.width < MIN_WIDTH || img.height < MIN_HEIGHT) {
          resolve({
            field: 'dimensions',
            message: `Imagem muito pequena. Dimensões mínimas: ${MIN_WIDTH}x${MIN_HEIGHT}px (sua imagem: ${img.width}x${img.height}px)`,
          });
          return;
        }

        // Check maximum dimensions
        if (img.width > MAX_WIDTH || img.height > MAX_HEIGHT) {
          resolve({
            field: 'dimensions',
            message: `Imagem muito grande. Dimensões máximas: ${MAX_WIDTH}x${MAX_HEIGHT}px (sua imagem: ${img.width}x${img.height}px)`,
          });
          return;
        }

        resolve(null);
      };

      img.onerror = () => {
        resolve({
          field: 'image',
          message: 'Arquivo não é uma imagem válida',
        });
      };

      img.src = e.target?.result as string;
    };

    reader.onerror = () => {
      resolve({
        field: 'read',
        message: 'Erro ao ler o arquivo',
      });
    };

    reader.readAsDataURL(file);
  });
};

/**
 * Full image validation (file + dimensions)
 */
export const validateImage = async (file: File): Promise<ImageValidationError | null> => {
  // First check file properties
  const fileError = validateImageFile(file);
  if (fileError) {
    return fileError;
  }

  // Then check dimensions
  const dimensionsError = await validateImageDimensions(file);
  if (dimensionsError) {
    return dimensionsError;
  }

  return null;
};

/**
 * Get file size in human readable format
 */
export const getFileSizeText = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
};
