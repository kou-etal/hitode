// @ts-nocheck
import Parser from "tree-sitter";
import CSharp from "tree-sitter-c-sharp";
import Java from "tree-sitter-java";
import JavaScript from "tree-sitter-javascript";
import TypeScript from "tree-sitter-typescript";

export interface CodeChunk {
  content: string;
  metadata: {
    language: string;
    filePath: string;
    type: "class" | "function" | "interface" | "method" | "block";
    name?: string;
    startLine: number;
    endLine: number;
  };
}

export type SupportedLanguage = "typescript" | "javascript" | "java" | "csharp";

export class CodeChunker {
  private parser: Parser;
  private language: SupportedLanguage;

  constructor(language: SupportedLanguage) {
    this.parser = new Parser();
    this.language = language;

    // Set appropriate tree-sitter language
    switch (language) {
      case "typescript":
        this.parser.setLanguage(TypeScript.typescript);
        break;
      case "javascript":
        this.parser.setLanguage(JavaScript);
        break;
      case "java":
        this.parser.setLanguage(Java);
        break;
      case "csharp":
        this.parser.setLanguage(CSharp);
        break;
    }
  }

  chunk(sourceCode: string, filePath: string): CodeChunk[] {
    const tree = this.parser.parse(sourceCode, undefined, {
      bufferSize: 100000, // Support large files
    });

    const chunks: CodeChunk[] = [];
    const rootNode = tree.rootNode;

    // Extract meaningful chunks based on language
    this.extractChunks(rootNode, sourceCode, filePath, chunks);

    return chunks;
  }

  private extractChunks(
    node: Parser.SyntaxNode,
    sourceCode: string,
    filePath: string,
    chunks: CodeChunk[],
  ) {
    // Define relevant node types based on language
    const relevantNodeTypes = this.getRelevantNodeTypes();

    if (relevantNodeTypes.includes(node.type)) {
      const content = sourceCode.substring(node.startIndex, node.endIndex);
      const name = this.extractName(node);

      chunks.push({
        content,
        metadata: {
          language: this.language,
          filePath,
          type: this.mapNodeTypeToChunkType(node.type),
          name,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
        },
      });
    }

    // Recursively process child nodes
    for (const child of node.children) {
      this.extractChunks(child, sourceCode, filePath, chunks);
    }
  }

  private getRelevantNodeTypes(): string[] {
    switch (this.language) {
      case "typescript":
      case "javascript":
        return [
          "class_declaration",
          "function_declaration",
          "method_definition",
          "interface_declaration",
          "type_alias_declaration",
          "arrow_function",
          "export_statement",
        ];
      case "java":
        return [
          "class_declaration",
          "interface_declaration",
          "method_declaration",
          "constructor_declaration",
          "enum_declaration",
        ];
      case "csharp":
        return [
          "class_declaration",
          "interface_declaration",
          "method_declaration",
          "constructor_declaration",
          "struct_declaration",
          "enum_declaration",
        ];
      default:
        return [];
    }
  }

  private extractName(node: Parser.SyntaxNode): string | undefined {
    // Extract name based on node type
    const nameNode = node.childForFieldName("name");
    if (nameNode) {
      return nameNode.text;
    }

    // Fallback for anonymous functions/classes
    if (node.type.includes("function") || node.type.includes("arrow")) {
      return "<anonymous>";
    }

    return undefined;
  }

  private mapNodeTypeToChunkType(
    nodeType: string,
  ): CodeChunk["metadata"]["type"] {
    // Map node type to chunk type
    if (nodeType.includes("class")) return "class";
    if (nodeType.includes("function")) return "function";
    if (nodeType.includes("method")) return "method";
    if (nodeType.includes("interface")) return "interface";
    return "block";
  }
}
