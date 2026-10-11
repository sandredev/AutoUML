import { StringStream } from '@codemirror/language';
import { describe, expect, it } from 'vitest';
import { pumlStreamParser } from '../../../src/presentation/editor/pumlLanguage';

type Tok = [text: string, style: string];

/** Tokeniza líneas seguidas con el mismo estado (como hace StreamLanguage) y quita los espacios. */
function tokenize(lines: string[]): Tok[][] {
  const parser = pumlStreamParser;
  const state = parser.startState ? parser.startState(2) : ({} as never);
  return lines.map((line) => {
    const out: Tok[] = [];
    if (line.trim() === '') {
      parser.blankLine?.(state, 2);
      return out;
    }
    const stream = new StringStream(line, 4, 2);
    while (!stream.eol()) {
      const style = parser.token(stream, state);
      const text = stream.current();
      if (stream.pos === stream.start) throw new Error(`el tokenizador no avanza en "${line}"`);
      if (style) out.push([text, style]);
      stream.start = stream.pos;
    }
    return out;
  });
}

const one = (line: string): Tok[] => tokenize([line])[0] ?? [];

describe('resaltado PlantUML (StreamLanguage)', () => {
  it('marcadores, preprocesador y comentarios', () => {
    expect(one('@startuml')).toEqual([['@startuml', 'meta']]);
    expect(one('!include common.iuml')).toEqual([['!include common.iuml', 'meta']]);
    expect(one("' un comentario")).toEqual([["' un comentario", 'comment']]);
  });

  it('comentario de bloque en varias líneas', () => {
    const [a, b, c] = tokenize(["/' empieza", 'sigue', "acaba '/ class A"]);
    expect(a).toEqual([["/' empieza", 'comment']]);
    expect(b).toEqual([['sigue', 'comment']]);
    expect(c?.[0]).toEqual(["acaba '/", 'comment']);
    expect(c?.slice(1)).toEqual([['class', 'keyword'], ['A', 'typeName']]);
  });

  it('declaración de tipo con estereotipo, color y herencia', () => {
    expect(one('abstract class Order <<entity>> #LightBlue extends Base {')).toEqual([
      ['abstract', 'keyword'],
      ['class', 'keyword'],
      ['Order', 'typeName'],
      ['<<entity>>', 'meta'],
      ['#LightBlue', 'atom'],
      ['extends', 'keyword'],
      ['Base', 'typeName'],
      ['{', 'brace'],
    ]);
  });

  it('nombre entre comillas y alias', () => {
    expect(one('class "Pedido de compra" as P')).toEqual([
      ['class', 'keyword'],
      ['"Pedido de compra"', 'string'],
      ['as', 'keyword'],
      ['P', 'typeName'],
    ]);
  });

  it('miembros: visibilidad, modificador y tipo después de los dos puntos', () => {
    const [, attr, method] = tokenize(['class A {', '  - id: long', '  {static} + total(): double']);
    expect(attr).toEqual([['-', 'operator'], ['id', 'propertyName'], [':', 'punctuation'], ['long', 'typeName']]);
    expect(method).toEqual([
      ['{static}', 'modifier'],
      ['+', 'operator'],
      ['total', 'propertyName'],
      ['(', 'punctuation'],
      [')', 'punctuation'],
      [':', 'punctuation'],
      ['double', 'typeName'],
    ]);
  });

  it('relación: flecha y etiqueta', () => {
    expect(one('Customer "1" --> "*" Order : compra >')).toEqual([
      ['Customer', 'typeName'],
      ['"1"', 'string'],
      ['-->', 'operator'],
      ['"*"', 'string'],
      ['Order', 'typeName'],
      [':', 'punctuation'],
      ['compra >', 'string'],
    ]);
  });

  it('flechas variadas del parser', () => {
    for (const arrow of ['<|--', '..|>', 'o--', '*-->', '-[#red,bold]->', '.up.>', '-left->']) {
      expect(one(`A ${arrow} B`)[1]).toEqual([arrow, 'operator']);
    }
  });

  it('nota de varias líneas: cuerpo como texto hasta "end note"', () => {
    const [head, body, end, after] = tokenize(['note left of A', 'texto libre class X', 'end note', 'class B']);
    expect(head?.[0]).toEqual(['note', 'keyword']);
    expect(body).toEqual([['texto libre class X', 'string']]);
    expect(end).toEqual([['end note', 'keyword']]);
    expect(after).toEqual([['class', 'keyword'], ['B', 'typeName']]);
  });

  it('nota de una línea no abre bloque', () => {
    const [, next] = tokenize(['note right of A : hola', 'class B']);
    expect(next).toEqual([['class', 'keyword'], ['B', 'typeName']]);
  });

  it('directivas', () => {
    expect(one('skinparam classBackgroundColor red')[0]).toEqual(['skinparam', 'keyword']);
    expect(one('left to right direction')).toEqual([['left to right direction', 'keyword']]);
    expect(one('hide empty members')[0]).toEqual(['hide', 'keyword']);
  });

  it('paquete: palabra clave, nombre y llaves', () => {
    expect(one('package com.shop {')).toEqual([['package', 'keyword'], ['com.shop', 'typeName'], ['{', 'brace']]);
  });

  it('las llaves de un paquete no convierten sus líneas en miembros', () => {
    const [, rel] = tokenize(['package p {', '  A --> B : usa']);
    expect(rel?.at(-1)).toEqual(['usa', 'string']);
  });

  it('una línea vacía no rompe el estado de la nota', () => {
    const [, , body] = tokenize(['note as N1', '', 'sigue la nota']);
    expect(body).toEqual([['sigue la nota', 'string']]);
  });
});
