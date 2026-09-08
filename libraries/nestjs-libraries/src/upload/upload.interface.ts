export interface IUploadProvider {
  resolveLocalFilePath?(publicUrl: string): string | undefined;
  uploadSimple(path: string): Promise<string>;
  uploadFile(file: Express.Multer.File): Promise<any>;
  removeFile(filePath: string): Promise<void>;
}
