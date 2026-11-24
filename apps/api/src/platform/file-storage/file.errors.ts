import { ErrorCode } from '@hse/shared';

import { AppError } from '../../core/errors/app-error';

const MB = 1024 * 1024;

export class FileTooLargeError extends AppError {
  constructor(maxBytes: number) {
    const max = Math.round((maxBytes / MB) * 10) / 10;
    super(ErrorCode.FILE_TOO_LARGE, 413, `This file is larger than ${max} MB.`, {
      params: { max },
    });
  }
}

export class FileTypeNotAllowedError extends AppError {
  constructor(contentTypes: readonly string[]) {
    const types = contentTypes.map((type) => type.split('/')[1]?.toUpperCase()).join(', ');
    super(
      ErrorCode.FILE_TYPE_NOT_ALLOWED,
      415,
      `This type of file isn't allowed here. Use ${types}.`,
      { params: { types } },
    );
  }
}

export class FileEmptyError extends AppError {
  constructor() {
    super(ErrorCode.FILE_EMPTY, 400, 'This file is empty.');
  }
}
