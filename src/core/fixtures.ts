// src/core/fixtures.ts — datos de prueba compartidos por los tests.
export const EJEMPLO = `@startuml
skinparam classAttributeIconSize 0
skinparam linetype ortho
set separator none
hide members

package "x.domain" as pkg_x_domain {
  abstract class Persona {
    - nombre: String
    # edad: int
    «create» + Persona(nombre: String, edad: int)
    + getNombre(): String
    + calcular(): double {abstract}
    ~ contador(): int {static}
  }
  class Estudiante {
    - codigo: String
    + estudiar(): void
    + mapa(m: Map<String, List<Integer>>, x: int): void
    + muchos(…7): void
  }
  interface Calificable {
    + nota(): double
  }
  enum EstadoEstudiante {
    ACTIVO
    RETIRADO
    GRADUADO
  }
  record Punto {
    + x: int
    + y: int
  }
  class "Foo" as h_a_Foo {
  }
  class Figura {
    <<sealed>>
    + area(): double
  }
}

package "EXTERNAL" {
  class List {
    <<external>>
  }
}

Persona <|-- Estudiante
Calificable <|.. Estudiante
Estudiante --> EstadoEstudiante
Estudiante ..> Punto
Estudiante -down-> Calificable
Calificable <|.down. Estudiante
pkg_x_domain -[hidden]down- pkg_x_util
' ---------------- EXTERNAL RELATIONSHIPS ----------------
Estudiante --> List
@enduml`;
